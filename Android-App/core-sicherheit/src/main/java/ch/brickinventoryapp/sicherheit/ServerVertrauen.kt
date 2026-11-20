package ch.brickinventoryapp.sicherheit

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.Socket
import java.security.MessageDigest
import java.security.cert.CertPathValidator
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.PKIXParameters
import java.security.cert.TrustAnchor
import java.security.cert.X509Certificate
import java.util.Base64
import javax.inject.Inject
import javax.inject.Singleton
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSession
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509ExtendedTrustManager

/**
 * Welchen Zertifizierungsstellen die Clients des eigenen Servers vertrauen: nur
 * den System-CAs, oder auf ausdrückliche Einstellung zusätzlich den vom Nutzer
 * installierten. Je Verbindungsaufbau gefragt, damit der Schalter ohne Neustart
 * wirkt. Eine nutzerinstallierte CA kann jeder einschleusen, der kurz ans Gerät
 * kommt oder es verwaltet — darum ist die Vorgabe aus (DevicesStore).
 */
// Eigener TrustManager mit Absicht: Er reicht an die System-Prüfung weiter und
// wählt nur, ob Nutzer-CAs mitzählen.
@Suppress("CustomX509TrustManager")
class ChoiceTrust(
    private val system: X509ExtendedTrustManager,
    /** Erst beim ersten Bedarf: Der CA-Speicher liest Hunderte Zertifikate von der Platte. */
    private val withUser: Lazy<X509ExtendedTrustManager>,
    private val userAllowed: () -> Boolean,
) : X509ExtendedTrustManager() {

    private fun wahl() = if (userAllowed()) withUser.value else system

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        wahl().checkServerTrusted(chain, authType, socket)

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        wahl().checkServerTrusted(chain, authType, engine)

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) =
        wahl().checkServerTrusted(chain, authType)

    // Die App weist sich nicht per Zertifikat aus; Client-Prüfungen bleiben beim System.
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        system.checkClientTrusted(chain, authType, socket)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        system.checkClientTrusted(chain, authType, engine)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
        system.checkClientTrusted(chain, authType)

    override fun getAcceptedIssuers(): Array<X509Certificate> = wahl().acceptedIssuers
}

/** SHA-256 über den SubjectPublicKeyInfo, Base64 — die Form des QR-Felds `fp`. */
fun spkiFingerprint(zertifikat: X509Certificate): String =
    Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(zertifikat.publicKey.encoded))

/** Ein Fingerabdruck im Format von `fp`: Base64 von genau 32 Bytes. */
fun isFingerprint(text: String?): Boolean =
    text != null && runCatching { Base64.getDecoder().decode(text.trim()).size == 32 }.getOrDefault(false)

/**
 * Was der Dialog vor dem Abtippen zeigt: nur die ersten 8 Hex-Zeichen, zur
 * Orientierung, welche Zeile in der Webapp gemeint ist. Abgetippt werden die
 * letzten 24 ([Transcript.confirmed]); stünden sie hier, schriebe man sie vom
 * Bildschirm des Angreifers ab statt aus der zweiten Quelle.
 */
fun fingerprintStart(fp: String): String = fingerprintReadable(fp).take(11) + " …"

/**
 * Für die Anzeige: Hex in Paaren mit Doppelpunkt, genau wie die Webapp ihn unter
 * „Server-Zertifikat“ zeigt (`fp_hex`). Gleiche Schreibweise heisst: Zeichen für
 * Zeichen vergleichbar, ohne umzurechnen.
 */
fun fingerprintReadable(fp: String): String =
    runCatching { Base64.getDecoder().decode(fp) }.getOrNull()
        ?.joinToString(":") { "%02X".format(it) } ?: fp

/** Unter diesem Schlüssel gilt ein Pin: Host und Port, ohne Schema und Pfad. */
fun pinKey(serverUrl: String): String? {
    val url = serverUrl.trim().trimEnd('/').toHttpUrlOrNull() ?: return null
    return if (url.isHttps) "${url.host.lowercase()}:${url.port}" else null
}

/** Der zweite Pin eines Servers: der Schlüssel seines Blatts, neben dem Pin der Wurzel. */
fun sheetPinKey(schluessel: String): String = "$schluessel#blatt"

/**
 * Zeigt ein Fingerabdruck auf eine System-Wurzel (ohne Nutzer-CAs)? Ein solcher Pin
 * verlangt ohnehin eine öffentlich gültige, CT-geprüfte Kette; jeder andere aus einer
 * fremden Quelle (QR-Code) gilt erst abgetippt.
 */
fun interface SystemRoots {
    fun contains(fingerabdruck: String): Boolean
}

/** Die gemerkten Pins: im Gerät SharedPreferences (DevicesStore), im Test eine Map. */
interface PinStore {
    fun pin(schluessel: String): String?
    fun rememberPin(schluessel: String, fingerabdruck: String)

    /**
     * Stammt der Pin aus einem eben gescannten Code (vorgehalten, noch nicht gemerkt)?
     * Dann muss der Server genau ihn zeigen, auch über eine öffentliche CA.
     */
    fun fromCode(schluessel: String): Boolean = false
}

/**
 * Eine Verbindung, über die nur der Nutzer entscheiden kann. Sie bricht den
 * Handshake ab, bevor ein Token hinausgeht; die Oberfläche fragt nach
 * ([CertificateQuestion]).
 */
class CertificateUnresolved(
    val schluessel: String,
    val fingerabdruck: String,
    val art: Art,
    /** Bei [Art.GEAENDERT] und [Art.SCHLUESSEL_NEU]: der gemerkte Pin. */
    val erwartet: String? = null,
    /** Der Schlüssel des Blatts; mit dem Ja zum Wurzel-Pin wird er zum zweiten Pin. */
    val blatt: String? = null,
    /** Prüft das System selbst Certificate Transparency (ab Android 16, network_security_config)? */
    val ctForced: Boolean = false,
) : CertificateException("Zertifikat von $schluessel nicht bestätigt ($art)") {
    /** Wo das Ja den [fingerabdruck] ablegt. */
    val storeKey: String get() = if (art == Art.SCHLUESSEL_NEU) sheetPinKey(schluessel) else schluessel

    /**
     * Gilt ein Ja nur mit einer Abschrift aus zweiter Quelle? Ohne CT-Pflicht (Android 11–15)
     * beim Erstkontakt und beim neuen Serverschlüssel ja: Sonst genügte eine fehlausgestellte
     * Kette irgendeiner öffentlichen CA und ein Tipp. Eine Abweichung vom Code ist gar nicht
     * zu bestätigen.
     */
    val transcriptNeeded: Boolean get() = when (art) {
        Art.CODE_ABWEICHUNG -> false
        Art.ERSTKONTAKT, Art.SCHLUESSEL_NEU -> !ctForced
        Art.UNBEKANNTE_CA, Art.NUTZER_CA, Art.GEAENDERT -> true
    }

    enum class Art {
        /**
         * Erster Kontakt, die Kette ist öffentlich gültig: Fingerabdruck zeigen und bestätigen
         * lassen, ohne CT-Pflicht erst abgetippt ([transcriptNeeded]).
         */
        ERSTKONTAKT,
        /** Keine bekannte Stelle hat das Zertifikat ausgestellt (selbst ausgestellt, interne CA). */
        UNBEKANNTE_CA,
        /**
         * Gültig nur über eine nutzerinstallierte CA (Schalter an). Abzutippen wie
         * [UNBEKANNTE_CA]: Eine solche CA schleust ein, wer das Gerät kurz hat.
         */
        NUTZER_CA,
        /** Der Server zeigt einen anderen Schlüssel als den gemerkten. */
        GEAENDERT,
        /**
         * Der Server zeigt einen anderen Schlüssel als der eben gescannte Code. Nicht zu
         * bestätigen: Code und Server sollten aus derselben Quelle stammen.
         */
        CODE_ABWEICHUNG,
        /**
         * Gleiche öffentliche Wurzel, aber ein anderer Serverschlüssel als der gemerkte
         * (Erneuerung mit neuem Schlüssel oder eine fehlausgestellte Kette derselben CA).
         * Abzutippen, solange das System kein CT verlangt ([transcriptNeeded]).
         */
        SCHLUESSEL_NEU,
    }
}

/**
 * Was gerade auf eine Entscheidung wartet. Der Handshake läuft auf einem
 * OkHttp-Faden; die Oberfläche liest hier und zeigt einen Dialog.
 */
interface CertificateQuestion {
    val offen: StateFlow<CertificateUnresolved?>
    fun melde(frage: CertificateUnresolved)
    fun confirm(pins: PinStore, eingabe: String? = null): Boolean
    fun verwerfen()

    /** Für Tests ohne Hilt. */
    companion object {
        operator fun invoke(): CertificateQuestion = CertificatePrompt()
    }
}

@Singleton
internal class CertificatePrompt @Inject constructor() : CertificateQuestion {
    private val _open = MutableStateFlow<CertificateUnresolved?>(null)
    override val offen: StateFlow<CertificateUnresolved?> = _open.asStateFlow()

    override fun melde(frage: CertificateUnresolved) {
        // Ein schon offener Dialog bleibt stehen; mehrere Abrufe scheitern gleichzeitig.
        if (_open.value == null) _open.value = frage
    }

    /**
     * Ja: Ab jetzt gilt genau dieser Schlüssel für diesen Server. Wo
     * [CertificateUnresolved.transcriptNeeded] gilt, nur mit [eingabe] aus einer zweiten
     * Quelle ([Transcript.confirmed]): Ein Tipp allein wäre genau das, was ein Angreifer
     * dazwischen braucht. Beim Erstkontakt mit CT-Pflicht ist das Abtippen freiwillig; wer
     * es tut, muss richtig tippen.
     */
    override fun confirm(pins: PinStore, eingabe: String?): Boolean {
        val f = _open.value ?: return false
        if (f.art == CertificateUnresolved.Art.CODE_ABWEICHUNG) return false
        val pruefen = f.transcriptNeeded || f.art == CertificateUnresolved.Art.ERSTKONTAKT && !eingabe.isNullOrBlank()
        if (pruefen && !Transcript.confirmed(eingabe, f.fingerabdruck)) return false
        pins.rememberPin(f.storeKey, f.fingerabdruck)
        f.blatt?.let { pins.rememberPin(sheetPinKey(f.schluessel), it) }
        _open.value = null
        return true
    }

    override fun verwerfen() {
        _open.value = null
    }
}

/**
 * Pinning für den eigenen Server: Ist ein Pin gemerkt (QR-Feld `fp` oder
 * bestätigter Erstkontakt), muss ein Zertifikat der gezeigten Kette ihn tragen,
 * und die Kette muss bis dahin lückenlos signiert sein — dann gilt sie auch ohne
 * bekannte CA. Ohne Pin wird nie still vertraut. Andere Hosts (Bild-CDN)
 */
// Das Pinning braucht ihn: Er prüft die Kette per PKIX bis zum Pin bzw. über
// ChoiceTrust und lehnt ab, was der Nutzer nicht bestätigt hat.
@Suppress("CustomX509TrustManager")
class PinTrust(
    /** Für den eigenen Server: [ChoiceTrust], also auf Wunsch mit Nutzer-CAs. */
    private val kette: X509ExtendedTrustManager,
    private val pins: PinStore,
    /** [pinKey] des eingerichteten Servers, oder null. */
    private val ownServer: () -> String?,
    private val frage: CertificateQuestion,
    /**
     * Für alle anderen Hosts: nur System-CAs. Der Schalter für Nutzer-CAs gilt dem
     * eigenen Server; ein Bild-CDN soll eine Firmen- oder Schad-CA nie annehmen.
     */
    private val foreignHosts: X509ExtendedTrustManager,
    /** Wurzeln, zwischen denen ein öffentlicher Pin still wechseln darf ([CA_FAMILIES]). */
    private val families: Map<String, String> = CA_FAMILIES,
    /** Ab Android 16 prüft das System CT; dann genügt für einen neuen Serverschlüssel ein Tipp. */
    private val ctForced: Boolean = false,
) : X509ExtendedTrustManager() {

    private fun schluessel(sitzung: SSLSession?): String? =
        sitzung?.peerHost?.let { "${it.lowercase()}:${sitzung.peerPort}" }

    private fun pruefe(chain: Array<X509Certificate>, schluessel: String?, mit: (X509ExtendedTrustManager) -> Unit) {
        if (schluessel == null) return withoutHost(chain) { mit(foreignHosts) }
        if (chain.isEmpty() || schluessel != ownServer()) return mit(foreignHosts)
        // Ohne Pin wird nie still vertraut; was die Rückfrage ist, sagt die Lage der Kette.
        val pin = pins.pin(schluessel) ?: throw situation(chain, mit).let {
            gemeldet(CertificateUnresolved(schluessel, it.fingerabdruck, it.kindWithoutPin, blatt = spkiFingerprint(chain[0]),
                ctForced = ctForced))
        }
        val fromCode = pins.fromCode(schluessel)
        // Ein Pin auf eine System-Wurzel gilt nur über die System-Prüfung samt Certificate
        // Transparency: Schickt der Server die Wurzel mit, umginge der Abgleich die CT-Prüfung.
        val publicPin = pin in systemRoots
        if (!publicPin && fitsToPin(chain, pin)) return
        val situation = situation(chain, mit)
        if (carriesPin(situation, pin, publicPin, fromCode)) return if (publicPin) checkSheet(chain[0], schluessel, fromCode) else Unit
        val art = if (fromCode) CertificateUnresolved.Art.CODE_ABWEICHUNG else CertificateUnresolved.Art.GEAENDERT
        throw gemeldet(CertificateUnresolved(schluessel, situation.fingerabdruck, art, erwartet = pin, blatt = spkiFingerprint(chain[0])))
    }

    /** Wie die Kette gilt und woran sie hängt. Öffentlich heisst: allein mit den System-CAs, nie über eine Nutzer-CA. */
    private fun situation(chain: Array<X509Certificate>, mit: (X509ExtendedTrustManager) -> Unit): Kettenlage {
        val oeffentlich = runCatching { mit(foreignHosts) }.isSuccess
        val viaUserCa = !oeffentlich && runCatching { mit(kette) }.isSuccess
        val root = when {
            oeffentlich -> anker(chain, foreignHosts.acceptedIssuers)
            viaUserCa -> anker(chain, kette.acceptedIssuers)
            else -> null
        }
        return Kettenlage(oeffentlich, viaUserCa, root, spkiFingerprint(root ?: chain.last()))
    }

    /**
     * Ein öffentlicher Pin bindet an die gepinnte Wurzel oder eine andere desselben Betreibers:
     * Ohne CT-Pflicht (Android 11–15) genügte sonst jede fehlausgestellte Kette irgendeiner CA.
     * Zwischenstellen (R10 → R11) und Wurzeln einer Familie (ISRG X1 → X2) wechseln still;
     * ein anderer Betreiber fragt wie ein geänderter Schlüssel. Ein Code verlangt genau seine Wurzel.
     */
    private fun carriesPin(situation: Kettenlage, pin: String, publicPin: Boolean, fromCode: Boolean): Boolean =
        if (publicPin) situation.oeffentlich && (situation.fingerabdruck == pin || !fromCode && sameOperator(pin, situation.fingerabdruck))
        else situation.viaUserCa && situation.root != null && situation.fingerabdruck == pin

    /**
     * Unter einer öffentlichen Wurzel genügt jede Kette dieser CA; der Schlüssel des Blatts
     * grenzt sie auf diesen Server ein. Fehlt er (ältere Fassung), wird er jetzt gemerkt;
     * ein Code vom angemeldeten Bildschirm tauscht ihn ohne Frage, sonst fragt die App.
     */
    private fun checkSheet(blatt: X509Certificate, schluessel: String, fromCode: Boolean) {
        val neu = spkiFingerprint(blatt)
        val gemerkt = pins.pin(sheetPinKey(schluessel))
        if (gemerkt == neu) return
        if (gemerkt == null || fromCode) return pins.rememberPin(sheetPinKey(schluessel), neu)
        throw gemeldet(CertificateUnresolved(schluessel, neu, CertificateUnresolved.Art.SCHLUESSEL_NEU,
            erwartet = gemerkt, ctForced = ctForced))
    }

    /** Beide sind System-Wurzeln derselben bekannten Familie; das O= im Subjekt wählt jede CA selbst. */
    private fun sameOperator(a: String, b: String): Boolean {
        if (a !in systemRoots || b !in systemRoots) return false
        return families[a]?.let { it == families[b] } ?: false
    }

    /** Die System-Wurzeln nach Fingerabdruck: Ein Pin auf eine davon heisst „öffentlich gültig“. */
    private val systemRoots: Map<String, X509Certificate> by lazy {
        foreignHosts.acceptedIssuers.associateBy(::spkiFingerprint)
    }

    private fun gemeldet(f: CertificateUnresolved): CertificateUnresolved = f.also { frage.melde(it) }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        pruefe(chain, schluessel((socket as? SSLSocket)?.handshakeSession)) {
            it.checkServerTrusted(chain, authType, socket)
        }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        pruefe(chain, schluessel(engine?.handshakeSession)) { it.checkServerTrusted(chain, authType, engine) }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) =
        withoutHost(chain) { foreignHosts.checkServerTrusted(chain, authType) }

    /**
     * Ohne Host (keine Handshake-Sitzung, keine Fassung mit Socket) ist nicht zu
     * sagen, ob es der eigene Server ist. Hat er einen eigenen Pin, muss die Kette
     * ihn tragen: Sonst genügte eine System-CA, wo der Pin eine bestimmte Stelle verlangt.
     */
    private fun withoutHost(chain: Array<X509Certificate>, system: () -> Unit) {
        val pin = ownServer()?.let(pins::pin)
        if (pin == null) return system()
        if (pin in systemRoots) {
            system()
            val root = spkiFingerprint(anker(chain, foreignHosts.acceptedIssuers) ?: chain.last())
            val blatt = ownServer()?.let { pins.pin(sheetPinKey(it)) }
            val sheetFits = blatt == null || chain.firstOrNull()?.let(::spkiFingerprint) == blatt
            if ((root == pin || sameOperator(pin, root)) && sheetFits) return
        } else if (fitsToPin(chain, pin)) return
        throw CertificateException("Ohne Host kein Abgleich mit dem Pin des eigenen Servers")
    }

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        kette.checkClientTrusted(chain, authType, socket)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        kette.checkClientTrusted(chain, authType, engine)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
        kette.checkClientTrusted(chain, authType)

    override fun getAcceptedIssuers(): Array<X509Certificate> = kette.acceptedIssuers
}

/**
 * Vertrauen für einen Server, der nicht (mehr) der eingerichtete sein muss: die
 * nachgeholte Entwertung nach einem Serverwechsel. Es gilt [pin] unter [schluessel]
 * wie für den eigenen Server. Eine Abweichung fragt niemanden (eigene
 * [CertificateQuestion]) und merkt nichts — sie bricht den Handshake nur ab.
 */
fun trustJob(
    kette: X509ExtendedTrustManager,
    system: X509ExtendedTrustManager,
    schluessel: String,
    pin: String?,
): PinTrust {
    val job = schluessel
    val ablage = object : PinStore {
        override fun pin(schluessel: String): String? = pin.takeIf { schluessel == job }
        override fun rememberPin(schluessel: String, fingerabdruck: String) = Unit
    }
    return PinTrust(kette, ablage, ownServer = { job }, frage = CertificateQuestion(), foreignHosts = system)
}

/**
 * Trägt ein Zertifikat der Kette den Pin, und ist alles darunter von ihm aus
 * gültig signiert? Nur den Pin irgendwo in der Kette zu finden genügte nicht:
 * Das Zertifikat einer internen CA ist öffentlich, ein Angreifer könnte es an
 * seine eigene Kette hängen.
 */
fun fitsToPin(chain: Array<X509Certificate>, pin: String): Boolean {
    val i = chain.indexOfFirst { spkiFingerprint(it) == pin }
    if (i < 0 || !forServer(chain[0])) return false
    if (i == 0) return runCatching { chain[0].checkValidity() }.isSuccess
    return runCatching {
        val pfad = CertificateFactory.getInstance("X.509").generateCertPath(chain.take(i))
        val parameter = PKIXParameters(setOf(TrustAnchor(chain[i], null))).apply { isRevocationEnabled = false }
        CertPathValidator.getInstance("PKIX").validate(pfad, parameter)
    }.isSuccess
}

/**
 * Darf das Blatt einen Server ausweisen? Die PKIX-Prüfung bis zum Pin fragt den
 * Zweck nicht; ohne diese Prüfung ginge unter einer gepinnten eigenen CA auch ein
 * Zertifikat für Code-Signatur oder E-Mail durch. Ohne EKU-Erweiterung ist jeder
 * Zweck erlaubt (RFC 5280).
 */
internal fun forServer(blatt: X509Certificate): Boolean {
    val purposes = runCatching { blatt.extendedKeyUsage }.getOrElse { return false } ?: return true
    return EKU_SERVER in purposes || EKU_EACH in purposes
}

/**
 * Wurzeln (SPKI-SHA-256, Base64) je Betreiber, zwischen denen ein öffentlicher Pin ohne
 * Frage wechselt. Fest statt aus dem O= des Subjekts: Das schreibt jede CA hinein, was sie
 * will. Werte mit openssl aus den Wurzeln gerechnet (Mozilla-Speicher, 14.11.2026).
 */
val CA_FAMILIES: Map<String, String> = mapOf(
    "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=" to "Let's Encrypt", // ISRG Root X1
    "diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=" to "Let's Encrypt", // ISRG Root X2
    "hxqRlPTu1bMS/0DITB1SSu0vd4u/8l8TjPgfaAp63Gc=" to "Google Trust Services", // GTS Root R1
    "QXnt2YHvdHR3tJYmQIr0Paosp6t/nggsEGD4QJZ3Q0g=" to "Google Trust Services", // GTS Root R3
    "mEflZT5enoR1FuXLgYYGqnVEoZvmf9c2bVBpiOjYQ0c=" to "Google Trust Services", // GTS Root R4
    "x4QzPSC810K5/cMjb05Qm4k3Bw5zBn4lTdO/nEW/Td4=" to "Sectigo", // USERTrust RSA (ZeroSSL)
    "ICGRfpgmOUXIWcQ/HXPLQTkFPEFPoDyjvH7ohhQpjzs=" to "Sectigo", // USERTrust ECC (ZeroSSL)
    "i7WTqTvh0OioIruIfFR4kMPnBqrS2rdiVPl/s2uC/CY=" to "DigiCert", // Global Root G2
    "uUwZgwDOxcBXrQcntwu+kYFpkiVkOaezL0WYEZ3anJc=" to "DigiCert", // Global Root G3
)

private const val EKU_SERVER = "1.3.6.1.5.5.7.3.1"
private const val EKU_EACH = "2.5.29.37.0"

/**
 * Die Stelle aus dem Vertrauensspeicher, die das oberste gesendete Zertifikat
 * ausgestellt hat (oder es selbst ist). Server senden die Wurzel meist nicht mit;
 * ohne diesen Schritt wäre der Pin eine Zwischenstelle, die die CA austauscht.
 */
internal fun anker(chain: Array<X509Certificate>, vertraut: Array<X509Certificate>): X509Certificate? {
    val oben = chain.lastOrNull() ?: return null
    return vertraut.firstOrNull {
        it.subjectX500Principal == oben.issuerX500Principal && runCatching { oben.verify(it.publicKey) }.isSuccess
    }
}

/**
 * Hat jemand den Fingerabdruck aus einer zweiten Quelle abgeschrieben (Webapp,
 * Zertifikatsanzeige des Browsers)?
 */
internal const val FINGERPRINT_TYPE_IN = 24

/**
 * Was eine Abschrift taugt. Der Dialog sagt „zu kurz“ anders als „passt nicht“: Die Webapp
 * zeigt `AB:CD:…`, und wer 24 sichtbare Zeichen samt Doppelpunkten abschrieb, hatte nur 16 Hex.
 */
enum class Transcript {
    LEER, TO_SHORT, FITS_NOT, PASST;

    companion object {
        /** So viele Hex-Zeichen vom Ende des Fingerabdrucks; Doppelpunkte und Leerzeichen zählen nicht. */
        const val NEEDED = FINGERPRINT_TYPE_IN

        fun confirmed(eingabe: String?, fp: String): Boolean = von(eingabe, fp) == PASST

        fun von(eingabe: String?, fp: String): Transcript {
            val roh = eingabe?.trim().orEmpty()
            if (roh.isNotEmpty() && roh == fp) return PASST
            val getippt = roh.uppercase().filter { it.isLetterOrDigit() }
            return when {
                getippt.isEmpty() -> LEER
                getippt.any { it !in "0123456789ABCDEF" } -> FITS_NOT
                getippt.length < FINGERPRINT_TYPE_IN -> TO_SHORT
                fingerprintReadable(fp).replace(":", "").endsWith(getippt) -> PASST
                else -> FITS_NOT
            }
        }
    }
}

/** Wie eine Kette gilt: allein mit den System-CAs, nur über eine Nutzer-CA oder gar nicht; dazu ihr Anker. */
private class Kettenlage(
    val oeffentlich: Boolean,
    val viaUserCa: Boolean,
    val root: X509Certificate?,
    val fingerabdruck: String,
) {
    /** Ohne Pin eine Frage an den Menschen: Erstkontakt, Nutzer-CA oder unbekannte CA. */
    val kindWithoutPin: CertificateUnresolved.Art get() = when {
        oeffentlich -> CertificateUnresolved.Art.ERSTKONTAKT
        viaUserCa -> CertificateUnresolved.Art.NUTZER_CA
        else -> CertificateUnresolved.Art.UNBEKANNTE_CA
    }
}

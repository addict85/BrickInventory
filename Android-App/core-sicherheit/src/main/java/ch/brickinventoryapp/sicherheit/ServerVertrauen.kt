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
import javax.security.auth.x500.X500Principal

/**
 * Welchen Zertifizierungsstellen die Clients des eigenen Servers vertrauen: nur
 * den System-CAs, oder auf ausdrückliche Einstellung zusätzlich den vom Nutzer
 * installierten. Je Verbindungsaufbau gefragt, damit der Schalter ohne Neustart
 * wirkt. Eine nutzerinstallierte CA kann jeder einschleusen, der kurz ans Gerät
 * kommt oder es verwaltet — darum ist die Vorgabe aus (GeraeteAblage).
 */
// Eigener TrustManager mit Absicht: Er reicht an die System-Prüfung weiter und
// wählt nur, ob Nutzer-CAs mitzählen.
@Suppress("CustomX509TrustManager")
class WahlVertrauen(
    private val system: X509ExtendedTrustManager,
    /** Erst beim ersten Bedarf: Der CA-Speicher liest Hunderte Zertifikate von der Platte. */
    private val mitNutzer: Lazy<X509ExtendedTrustManager>,
    private val nutzerErlaubt: () -> Boolean,
) : X509ExtendedTrustManager() {

    private fun wahl() = if (nutzerErlaubt()) mitNutzer.value else system

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
fun spkiFingerabdruck(zertifikat: X509Certificate): String =
    Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(zertifikat.publicKey.encoded))

/** Ein Fingerabdruck im Format von `fp`: Base64 von genau 32 Bytes. */
fun istFingerabdruck(text: String?): Boolean =
    text != null && runCatching { Base64.getDecoder().decode(text.trim()).size == 32 }.getOrDefault(false)

/**
 * Was der Dialog vor dem Abtippen zeigt: nur die ersten 8 Hex-Zeichen, zur
 * Orientierung, welche Zeile in der Webapp gemeint ist. Abgetippt werden die
 * letzten 24 ([Abschrift.bestaetigt]); stünden sie hier, schriebe man sie vom
 * Bildschirm des Angreifers ab statt aus der zweiten Quelle.
 */
fun fingerabdruckAnfang(fp: String): String = fingerabdruckLesbar(fp).take(11) + " …"

/**
 * Für die Anzeige: Hex in Paaren mit Doppelpunkt, genau wie die Webapp ihn unter
 * „Server-Zertifikat“ zeigt (`fp_hex`). Gleiche Schreibweise heisst: Zeichen für
 * Zeichen vergleichbar, ohne umzurechnen.
 */
fun fingerabdruckLesbar(fp: String): String =
    runCatching { Base64.getDecoder().decode(fp) }.getOrNull()
        ?.joinToString(":") { "%02X".format(it) } ?: fp

/** Unter diesem Schlüssel gilt ein Pin: Host und Port, ohne Schema und Pfad. */
fun pinSchluessel(serverUrl: String): String? {
    val url = serverUrl.trim().trimEnd('/').toHttpUrlOrNull() ?: return null
    return if (url.isHttps) "${url.host.lowercase()}:${url.port}" else null
}

/**
 * Zeigt ein Fingerabdruck auf eine System-Wurzel (ohne Nutzer-CAs)? Ein solcher Pin
 * verlangt ohnehin eine öffentlich gültige, CT-geprüfte Kette; jeder andere aus einer
 * fremden Quelle (QR-Code) gilt erst abgetippt.
 */
fun interface SystemWurzeln {
    fun enthaelt(fingerabdruck: String): Boolean
}

/** Die gemerkten Pins: im Gerät SharedPreferences (GeraeteAblage), im Test eine Map. */
interface PinAblage {
    fun pin(schluessel: String): String?
    fun merkePin(schluessel: String, fingerabdruck: String)

    /**
     * Stammt der Pin aus einem eben gescannten Code (vorgehalten, noch nicht gemerkt)?
     * Dann muss der Server genau ihn zeigen, auch über eine öffentliche CA.
     */
    fun ausCode(schluessel: String): Boolean = false
}

/**
 * Eine Verbindung, über die nur der Nutzer entscheiden kann. Sie bricht den
 * Handshake ab, bevor ein Token hinausgeht; die Oberfläche fragt nach
 * ([ZertifikatsFrage]).
 */
class ZertifikatUngeklaert(
    val schluessel: String,
    val fingerabdruck: String,
    val art: Art,
    /** Bei [Art.GEAENDERT]: der gemerkte Pin. */
    val erwartet: String? = null,
) : CertificateException("Zertifikat von $schluessel nicht bestätigt ($art)") {
    enum class Art {
        /** Erster Kontakt, die Kette ist gültig: Fingerabdruck zeigen und bestätigen lassen. */
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
    }
}

/**
 * Was gerade auf eine Entscheidung wartet. Der Handshake läuft auf einem
 * OkHttp-Faden; die Oberfläche liest hier und zeigt einen Dialog.
 */
interface ZertifikatsFrage {
    val offen: StateFlow<ZertifikatUngeklaert?>
    fun melde(frage: ZertifikatUngeklaert)
    fun bestaetige(pins: PinAblage, eingabe: String? = null): Boolean
    fun verwerfen()

    /** Für Tests ohne Hilt. */
    companion object {
        operator fun invoke(): ZertifikatsFrage = ZertifikatsRueckfrage()
    }
}

@Singleton
internal class ZertifikatsRueckfrage @Inject constructor() : ZertifikatsFrage {
    private val _offen = MutableStateFlow<ZertifikatUngeklaert?>(null)
    override val offen: StateFlow<ZertifikatUngeklaert?> = _offen.asStateFlow()

    override fun melde(frage: ZertifikatUngeklaert) {
        // Ein schon offener Dialog bleibt stehen; mehrere Abrufe scheitern gleichzeitig.
        if (_offen.value == null) _offen.value = frage
    }

    /**
     * Ja: Ab jetzt gilt genau dieser Schlüssel für diesen Server. Ohne bekannte CA
     * oder bei geändertem Schlüssel nur mit [eingabe] aus einer zweiten Quelle
     * ([Abschrift.bestaetigt]): Dort prüft sonst niemand die Kette, und ein Tipp
     * allein wäre genau das, was ein Angreifer dazwischen braucht.
     */
    override fun bestaetige(pins: PinAblage, eingabe: String?): Boolean {
        val f = _offen.value ?: return false
        if (f.art == ZertifikatUngeklaert.Art.CODE_ABWEICHUNG) return false
        if (f.art != ZertifikatUngeklaert.Art.ERSTKONTAKT && !Abschrift.bestaetigt(eingabe, f.fingerabdruck)) return false
        pins.merkePin(f.schluessel, f.fingerabdruck)
        _offen.value = null
        return true
    }

    override fun verwerfen() {
        _offen.value = null
    }
}

/**
 * Pinning für den eigenen Server: Ist ein Pin gemerkt (QR-Feld `fp` oder
 * bestätigter Erstkontakt), muss ein Zertifikat der gezeigten Kette ihn tragen,
 * und die Kette muss bis dahin lückenlos signiert sein — dann gilt sie auch ohne
 * bekannte CA. Ohne Pin wird nie still vertraut. Andere Hosts (Bild-CDN)
 */
// Das Pinning braucht ihn: Er prüft die Kette per PKIX bis zum Pin bzw. über
// WahlVertrauen und lehnt ab, was der Nutzer nicht bestätigt hat.
@Suppress("CustomX509TrustManager")
class PinVertrauen(
    /** Für den eigenen Server: [WahlVertrauen], also auf Wunsch mit Nutzer-CAs. */
    private val kette: X509ExtendedTrustManager,
    private val pins: PinAblage,
    /** [pinSchluessel] des eingerichteten Servers, oder null. */
    private val eigenerServer: () -> String?,
    private val frage: ZertifikatsFrage,
    /**
     * Für alle anderen Hosts: nur System-CAs. Der Schalter für Nutzer-CAs gilt dem
     * eigenen Server; ein Bild-CDN soll eine Firmen- oder Schad-CA nie annehmen.
     */
    private val fremdeHosts: X509ExtendedTrustManager,
) : X509ExtendedTrustManager() {

    private fun schluessel(sitzung: SSLSession?): String? =
        sitzung?.peerHost?.let { "${it.lowercase()}:${sitzung.peerPort}" }

    private fun pruefe(chain: Array<X509Certificate>, schluessel: String?, mit: (X509ExtendedTrustManager) -> Unit) {
        if (schluessel == null) return ohneHost(chain) { mit(fremdeHosts) }
        if (chain.isEmpty() || schluessel != eigenerServer()) return mit(fremdeHosts)
        // Ohne Pin wird nie still vertraut; was die Rückfrage ist, sagt die Lage der Kette.
        val pin = pins.pin(schluessel)
            ?: throw lage(chain, mit).let { gemeldet(ZertifikatUngeklaert(schluessel, it.fingerabdruck, it.artOhnePin)) }
        val ausCode = pins.ausCode(schluessel)
        // Ein Pin auf eine System-Wurzel gilt nur über die System-Prüfung samt Certificate
        // Transparency: Schickt der Server die Wurzel mit, umginge der Abgleich die CT-Prüfung.
        val oeffentlicherPin = pin in systemWurzeln
        if (!oeffentlicherPin && passtZumPin(chain, pin)) return
        val lage = lage(chain, mit)
        if (traegtPin(lage, pin, oeffentlicherPin, ausCode)) return
        val art = if (ausCode) ZertifikatUngeklaert.Art.CODE_ABWEICHUNG else ZertifikatUngeklaert.Art.GEAENDERT
        throw gemeldet(ZertifikatUngeklaert(schluessel, lage.fingerabdruck, art, erwartet = pin))
    }

    /** Wie die Kette gilt und woran sie hängt. Öffentlich heisst: allein mit den System-CAs, nie über eine Nutzer-CA. */
    private fun lage(chain: Array<X509Certificate>, mit: (X509ExtendedTrustManager) -> Unit): Kettenlage {
        val oeffentlich = runCatching { mit(fremdeHosts) }.isSuccess
        val ueberNutzerCa = !oeffentlich && runCatching { mit(kette) }.isSuccess
        val wurzel = when {
            oeffentlich -> anker(chain, fremdeHosts.acceptedIssuers)
            ueberNutzerCa -> anker(chain, kette.acceptedIssuers)
            else -> null
        }
        return Kettenlage(oeffentlich, ueberNutzerCa, wurzel, spkiFingerabdruck(wurzel ?: chain.last()))
    }

    /**
     * Ein öffentlicher Pin bindet an die gepinnte Wurzel oder eine andere desselben Betreibers:
     * Ohne CT-Pflicht (Android 11–15) genügte sonst jede fehlausgestellte Kette irgendeiner CA.
     * Zwischenstellen (R10 → R11) und Wurzeln einer Familie (ISRG X1 → X2) wechseln still;
     * ein anderer Betreiber fragt wie ein geänderter Schlüssel. Ein Code verlangt genau seine Wurzel.
     */
    private fun traegtPin(lage: Kettenlage, pin: String, oeffentlicherPin: Boolean, ausCode: Boolean): Boolean =
        if (oeffentlicherPin) lage.oeffentlich && (lage.fingerabdruck == pin || !ausCode && gleicherBetreiber(pin, lage.fingerabdruck))
        else lage.ueberNutzerCa && lage.wurzel != null && lage.fingerabdruck == pin

    /** Beide sind System-Wurzeln, und ihr Subjekt nennt dieselbe Organisation (O=). */
    private fun gleicherBetreiber(a: String, b: String): Boolean {
        val betreiberA = systemWurzeln[a]?.let(::betreiber) ?: return false
        return betreiberA == systemWurzeln[b]?.let(::betreiber)
    }

    /** Die System-Wurzeln nach Fingerabdruck: Ein Pin auf eine davon heisst „öffentlich gültig“. */
    private val systemWurzeln: Map<String, X509Certificate> by lazy {
        fremdeHosts.acceptedIssuers.associateBy(::spkiFingerabdruck)
    }

    private fun gemeldet(f: ZertifikatUngeklaert): ZertifikatUngeklaert = f.also { frage.melde(it) }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        pruefe(chain, schluessel((socket as? SSLSocket)?.handshakeSession)) {
            it.checkServerTrusted(chain, authType, socket)
        }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        pruefe(chain, schluessel(engine?.handshakeSession)) { it.checkServerTrusted(chain, authType, engine) }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) =
        ohneHost(chain) { fremdeHosts.checkServerTrusted(chain, authType) }

    /**
     * Ohne Host (keine Handshake-Sitzung, keine Fassung mit Socket) ist nicht zu
     * sagen, ob es der eigene Server ist. Hat er einen eigenen Pin, muss die Kette
     * ihn tragen: Sonst genügte eine System-CA, wo der Pin eine bestimmte Stelle verlangt.
     */
    private fun ohneHost(chain: Array<X509Certificate>, system: () -> Unit) {
        val pin = eigenerServer()?.let(pins::pin)
        if (pin == null) return system()
        if (pin in systemWurzeln) {
            system()
            val wurzel = spkiFingerabdruck(anker(chain, fremdeHosts.acceptedIssuers) ?: chain.last())
            if (wurzel == pin || gleicherBetreiber(pin, wurzel)) return
        } else if (passtZumPin(chain, pin)) return
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
 * [ZertifikatsFrage]) und merkt nichts — sie bricht den Handshake nur ab.
 */
fun auftragsVertrauen(
    kette: X509ExtendedTrustManager,
    system: X509ExtendedTrustManager,
    schluessel: String,
    pin: String?,
): PinVertrauen {
    val auftrag = schluessel
    val ablage = object : PinAblage {
        override fun pin(schluessel: String): String? = pin.takeIf { schluessel == auftrag }
        override fun merkePin(schluessel: String, fingerabdruck: String) = Unit
    }
    return PinVertrauen(kette, ablage, eigenerServer = { auftrag }, frage = ZertifikatsFrage(), fremdeHosts = system)
}

/**
 * Trägt ein Zertifikat der Kette den Pin, und ist alles darunter von ihm aus
 * gültig signiert? Nur den Pin irgendwo in der Kette zu finden genügte nicht:
 * Das Zertifikat einer internen CA ist öffentlich, ein Angreifer könnte es an
 * seine eigene Kette hängen.
 */
fun passtZumPin(chain: Array<X509Certificate>, pin: String): Boolean {
    val i = chain.indexOfFirst { spkiFingerabdruck(it) == pin }
    if (i < 0 || !fuerServer(chain[0])) return false
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
internal fun fuerServer(blatt: X509Certificate): Boolean {
    val zwecke = runCatching { blatt.extendedKeyUsage }.getOrElse { return false } ?: return true
    return EKU_SERVER in zwecke || EKU_JEDER in zwecke
}

/** Die Organisation (O=) im Subjekt; ohne sie ist eine Wurzel mit keiner anderen verwandt. */
internal fun betreiber(zert: X509Certificate): String? =
    zert.subjectX500Principal.getName(X500Principal.RFC2253)
        .split(UNMASKIERTES_KOMMA).map { it.trim() }
        .firstOrNull { it.startsWith("O=") }?.removePrefix("O=")?.takeIf { it.isNotBlank() }

private val UNMASKIERTES_KOMMA = Regex("""(?<!\\),""")

private const val EKU_SERVER = "1.3.6.1.5.5.7.3.1"
private const val EKU_JEDER = "2.5.29.37.0"

/**
 * Die Stelle aus dem Vertrauensspeicher, die das oberste gesendete Zertifikat
 * ausgestellt hat (oder es selbst ist). Server senden die Wurzel meist nicht mit;
 * ohne diesen Schritt wäre der Pin eine Zwischenstelle, die die CA austauscht.
 */
fun anker(chain: Array<X509Certificate>, vertraut: Array<X509Certificate>): X509Certificate? {
    val oben = chain.lastOrNull() ?: return null
    return vertraut.firstOrNull {
        it.subjectX500Principal == oben.issuerX500Principal && runCatching { oben.verify(it.publicKey) }.isSuccess
    }
}

/**
 * Hat jemand den Fingerabdruck aus einer zweiten Quelle abgeschrieben (Webapp,
 * Zertifikatsanzeige des Browsers)?
 */
internal const val FINGERABDRUCK_ABTIPPEN = 24

/**
 * Was eine Abschrift taugt. Der Dialog sagt „zu kurz“ anders als „passt nicht“: Die Webapp
 * zeigt `AB:CD:…`, und wer 24 sichtbare Zeichen samt Doppelpunkten abschrieb, hatte nur 16 Hex.
 */
enum class Abschrift {
    LEER, ZU_KURZ, PASST_NICHT, PASST;

    companion object {
        /** So viele Hex-Zeichen vom Ende des Fingerabdrucks; Doppelpunkte und Leerzeichen zählen nicht. */
        const val NOETIG = FINGERABDRUCK_ABTIPPEN

        fun bestaetigt(eingabe: String?, fp: String): Boolean = von(eingabe, fp) == PASST

        fun von(eingabe: String?, fp: String): Abschrift {
            val roh = eingabe?.trim().orEmpty()
            if (roh.isNotEmpty() && roh == fp) return PASST
            val getippt = roh.uppercase().filter { it.isLetterOrDigit() }
            return when {
                getippt.isEmpty() -> LEER
                getippt.any { it !in "0123456789ABCDEF" } -> PASST_NICHT
                getippt.length < FINGERABDRUCK_ABTIPPEN -> ZU_KURZ
                fingerabdruckLesbar(fp).replace(":", "").endsWith(getippt) -> PASST
                else -> PASST_NICHT
            }
        }
    }
}

/** Wie eine Kette gilt: allein mit den System-CAs, nur über eine Nutzer-CA oder gar nicht; dazu ihr Anker. */
private class Kettenlage(
    val oeffentlich: Boolean,
    val ueberNutzerCa: Boolean,
    val wurzel: X509Certificate?,
    val fingerabdruck: String,
) {
    /** Ohne Pin eine Frage an den Menschen: Erstkontakt, Nutzer-CA oder unbekannte CA. */
    val artOhnePin: ZertifikatUngeklaert.Art get() = when {
        oeffentlich -> ZertifikatUngeklaert.Art.ERSTKONTAKT
        ueberNutzerCa -> ZertifikatUngeklaert.Art.NUTZER_CA
        else -> ZertifikatUngeklaert.Art.UNBEKANNTE_CA
    }
}

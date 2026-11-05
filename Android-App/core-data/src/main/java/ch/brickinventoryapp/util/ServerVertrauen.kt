package ch.brickinventoryapp.util

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
 * letzten 24 ([bestaetigtFingerabdruck]); stünden sie hier, schriebe man sie vom
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
}

/** Für Tests ohne Hilt. */
fun ZertifikatsFrage(): ZertifikatsFrage = ZertifikatsRueckfrage()

@Singleton
class ZertifikatsRueckfrage @Inject constructor() : ZertifikatsFrage {
    private val _offen = MutableStateFlow<ZertifikatUngeklaert?>(null)
    override val offen: StateFlow<ZertifikatUngeklaert?> = _offen.asStateFlow()

    override fun melde(frage: ZertifikatUngeklaert) {
        // Ein schon offener Dialog bleibt stehen; mehrere Abrufe scheitern gleichzeitig.
        if (_offen.value == null) _offen.value = frage
    }

    /**
     * Ja: Ab jetzt gilt genau dieser Schlüssel für diesen Server. Ohne bekannte CA
     * oder bei geändertem Schlüssel nur mit [eingabe] aus einer zweiten Quelle
     * ([bestaetigtFingerabdruck]): Dort prüft sonst niemand die Kette, und ein Tipp
     * allein wäre genau das, was ein Angreifer dazwischen braucht.
     */
    override fun bestaetige(pins: PinAblage, eingabe: String?): Boolean {
        val f = _offen.value ?: return false
        if (f.art != ZertifikatUngeklaert.Art.ERSTKONTAKT && !bestaetigtFingerabdruck(eingabe, f.fingerabdruck)) return false
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
 * Ausführlich: docs/begruendungen/core-data/util/ServerVertrauen.kt.md#z170
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
        val pin = pins.pin(schluessel)
        // Ein Pin auf eine System-Wurzel gilt nur über die System-Prüfung samt Certificate
        // Transparency: Schickt der Server die Wurzel mit, umginge der Abgleich die CT-Prüfung.
        val oeffentlicherPin = pin != null && pin in systemWurzeln
        if (pin != null && !oeffentlicherPin && passtZumPin(chain, pin)) return
        // Öffentlich heisst: allein mit den System-CAs, nie über eine Nutzer-CA.
        val oeffentlich = runCatching { mit(fremdeHosts) }.isSuccess
        // Ein öffentlicher Pin bindet Host und System-Gültigkeit, nicht eine Wurzel:
        // Wechselt die CA ihre Wurzel (Let's Encrypt X1 → X2), fragt die App nicht neu.
        if (oeffentlicherPin && oeffentlich) return
        val ueberNutzerCa = !oeffentlich && runCatching { mit(kette) }.isSuccess
        val wurzel = when {
            oeffentlich -> anker(chain, fremdeHosts.acceptedIssuers)
            ueberNutzerCa -> anker(chain, kette.acceptedIssuers)
            else -> null
        }
        val fp = spkiFingerabdruck(wurzel ?: chain.last())
        if (pin != null) {
            // Gepinnte Nutzer-CA: Die Kette hat eben bis zu ihr gegolten.
            if (ueberNutzerCa && wurzel != null && fp == pin && !oeffentlicherPin) return
            throw gemeldet(ZertifikatUngeklaert(schluessel, fp, ZertifikatUngeklaert.Art.GEAENDERT, erwartet = pin))
        }
        val art = when {
            oeffentlich -> ZertifikatUngeklaert.Art.ERSTKONTAKT
            ueberNutzerCa -> ZertifikatUngeklaert.Art.NUTZER_CA
            else -> ZertifikatUngeklaert.Art.UNBEKANNTE_CA
        }
        throw gemeldet(ZertifikatUngeklaert(schluessel, fp, art))
    }

    /** Fingerabdrücke der System-Wurzeln: Ein Pin auf eine davon heisst „öffentlich gültig“. */
    private val systemWurzeln: Set<String> by lazy { fremdeHosts.acceptedIssuers.map(::spkiFingerabdruck).toSet() }

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
        if (pin == null || pin in systemWurzeln) return system()
        if (!passtZumPin(chain, pin)) throw CertificateException("Ohne Host kein Abgleich mit dem Pin des eigenen Servers")
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
internal fun auftragsVertrauen(
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
 * Ausführlich: docs/begruendungen/core-data/util/ServerVertrauen.kt.md#fingerabdruck-abtippen
 */
const val FINGERABDRUCK_ABTIPPEN = 24

fun bestaetigtFingerabdruck(eingabe: String?, fp: String): Boolean {
    val roh = eingabe?.trim().orEmpty()
    if (roh.isEmpty()) return false
    if (roh == fp) return true
    val hex = fingerabdruckLesbar(fp).replace(":", "")
    val getippt = roh.uppercase().filter { it.isLetterOrDigit() }
    return getippt.length >= FINGERABDRUCK_ABTIPPEN && getippt.all { it in "0123456789ABCDEF" } && hex.endsWith(getippt)
}

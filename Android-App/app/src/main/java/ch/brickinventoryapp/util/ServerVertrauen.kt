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
 * kommt oder es verwaltet — darum ist die Vorgabe aus (PreferencesManager).
 */
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

/** Für die Anzeige: Hex in Vierergruppen liest sich laut vor und lässt sich vergleichen. */
fun fingerabdruckLesbar(fp: String): String =
    runCatching { Base64.getDecoder().decode(fp) }.getOrNull()
        ?.joinToString("") { "%02X".format(it) }?.chunked(4)?.joinToString(" ") ?: fp

/** Unter diesem Schlüssel gilt ein Pin: Host und Port, ohne Schema und Pfad. */
fun pinSchluessel(serverUrl: String): String? {
    val url = serverUrl.trim().trimEnd('/').toHttpUrlOrNull() ?: return null
    return if (url.isHttps) "${url.host.lowercase()}:${url.port}" else null
}

/** Die gemerkten Pins: im Gerät SharedPreferences (PreferencesManager), im Test eine Map. */
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
        /** Der Server zeigt einen anderen Schlüssel als den gemerkten. */
        GEAENDERT,
    }
}

/**
 * Was gerade auf eine Entscheidung wartet. Der Handshake läuft auf einem
 * OkHttp-Faden; die Oberfläche liest hier und zeigt einen Dialog.
 */
@Singleton
class ZertifikatsFrage @Inject constructor() {
    private val _offen = MutableStateFlow<ZertifikatUngeklaert?>(null)
    val offen: StateFlow<ZertifikatUngeklaert?> = _offen.asStateFlow()

    fun melde(frage: ZertifikatUngeklaert) {
        // Ein schon offener Dialog bleibt stehen; mehrere Abrufe scheitern gleichzeitig.
        if (_offen.value == null) _offen.value = frage
    }

    /** Ja: Ab jetzt gilt genau dieser Schlüssel für diesen Server. */
    fun bestaetige(pins: PinAblage) {
        val f = _offen.value ?: return
        pins.merkePin(f.schluessel, f.fingerabdruck)
        _offen.value = null
    }

    fun verwerfen() {
        _offen.value = null
    }
}

/**
 * Pinning für den eigenen Server: Ist ein Pin gemerkt (QR-Feld `fp` oder
 * bestätigter Erstkontakt), muss ein Zertifikat der gezeigten Kette ihn tragen,
 * und die Kette muss bis dahin lückenlos signiert sein — dann gilt sie auch ohne
 * bekannte CA. Ohne Pin wird nie still vertraut. Andere Hosts (Bild-CDN)
 * prüft nur die Kette.
 */
class PinVertrauen(
    private val kette: X509ExtendedTrustManager,
    private val pins: PinAblage,
    /** [pinSchluessel] des eingerichteten Servers, oder null. */
    private val eigenerServer: () -> String?,
    private val frage: ZertifikatsFrage,
) : X509ExtendedTrustManager() {

    private fun schluessel(sitzung: SSLSession?): String? =
        sitzung?.peerHost?.let { "${it.lowercase()}:${sitzung.peerPort}" }

    private fun pruefe(chain: Array<X509Certificate>, schluessel: String?, kettenPruefung: () -> Unit) {
        if (schluessel == null || chain.isEmpty() || schluessel != eigenerServer()) return kettenPruefung()
        val fp = spkiFingerabdruck(chain[0])
        val pin = pins.pin(schluessel)
        if (pin != null) {
            if (passtZumPin(chain, pin)) return
            throw gemeldet(ZertifikatUngeklaert(schluessel, fp, ZertifikatUngeklaert.Art.GEAENDERT, erwartet = pin))
        }
        val kettenOk = runCatching { kettenPruefung() }.isSuccess
        throw gemeldet(ZertifikatUngeklaert(schluessel, fp,
            if (kettenOk) ZertifikatUngeklaert.Art.ERSTKONTAKT else ZertifikatUngeklaert.Art.UNBEKANNTE_CA))
    }

    private fun gemeldet(f: ZertifikatUngeklaert): ZertifikatUngeklaert = f.also { frage.melde(it) }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        pruefe(chain, schluessel((socket as? SSLSocket)?.handshakeSession)) {
            kette.checkServerTrusted(chain, authType, socket)
        }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        pruefe(chain, schluessel(engine?.handshakeSession)) { kette.checkServerTrusted(chain, authType, engine) }

    // Ohne Socket kein Host: nur die Kette, kein Pin. Android ruft die Fassung mit Socket.
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) =
        kette.checkServerTrusted(chain, authType)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        kette.checkClientTrusted(chain, authType, socket)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        kette.checkClientTrusted(chain, authType, engine)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
        kette.checkClientTrusted(chain, authType)

    override fun getAcceptedIssuers(): Array<X509Certificate> = kette.acceptedIssuers
}

/**
 * Trägt ein Zertifikat der Kette den Pin, und ist alles darunter von ihm aus
 * gültig signiert? Nur den Pin irgendwo in der Kette zu finden genügte nicht:
 * Das Zertifikat einer internen CA ist öffentlich, ein Angreifer könnte es an
 * seine eigene Kette hängen.
 */
fun passtZumPin(chain: Array<X509Certificate>, pin: String): Boolean {
    val i = chain.indexOfFirst { spkiFingerabdruck(it) == pin }
    if (i < 0) return false
    if (i == 0) return runCatching { chain[0].checkValidity() }.isSuccess
    return runCatching {
        val pfad = CertificateFactory.getInstance("X.509").generateCertPath(chain.take(i))
        val parameter = PKIXParameters(setOf(TrustAnchor(chain[i], null))).apply { isRevocationEnabled = false }
        CertPathValidator.getInstance("PKIX").validate(pfad, parameter)
    }.isSuccess
}

package ch.brickinventoryapp.security

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
 * Which certificate authorities the clients of the app's own server trust: only
 * the system CAs, or, on explicit setting, additionally the ones the user
 * installed. Asked on every connection setup, so the switch takes effect without a restart.
 * A user-installed CA can be planted by anyone who briefly gets hold of the device
 * or manages it — which is why the default is off (DevicesStore).
 */
// Own TrustManager on purpose: it delegates to the system check and
// only chooses whether user CAs count too.
@Suppress("CustomX509TrustManager")
class ChoiceTrust(
    private val system: X509ExtendedTrustManager,
    /** Only on first need: the CA store reads hundreds of certificates from disk. */
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

    // The app doesn't identify itself via a certificate; client checks stay with the system.
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        system.checkClientTrusted(chain, authType, socket)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        system.checkClientTrusted(chain, authType, engine)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
        system.checkClientTrusted(chain, authType)

    override fun getAcceptedIssuers(): Array<X509Certificate> = wahl().acceptedIssuers
}

/** SHA-256 over the SubjectPublicKeyInfo, Base64 — the form of the QR field `fp`. */
fun spkiFingerprint(zertifikat: X509Certificate): String =
    Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(zertifikat.publicKey.encoded))

/** A fingerprint in the format of `fp`: Base64 of exactly 32 bytes. */
fun isFingerprint(text: String?): Boolean =
    text != null && runCatching { Base64.getDecoder().decode(text.trim()).size == 32 }.getOrDefault(false)

/**
 * What the dialog shows before typing it in: only the first 8 hex characters, for
 * orientation on which row in the web app is meant. The last 24 are typed in
 * ([Transcript.confirmed]); if they stood here too, one would copy them from the
 * attacker's screen instead of from the second source.
 */
fun fingerprintStart(fp: String): String = fingerprintReadable(fp).take(11) + " …"

/**
 * For display: hex in pairs with colons, exactly as the web app shows it under
 * „Server-Zertifikat“ (`fp_hex`). Same notation means: comparable character for
 * character, without converting.
 */
fun fingerprintReadable(fp: String): String =
    runCatching { Base64.getDecoder().decode(fp) }.getOrNull()
        ?.joinToString(":") { "%02X".format(it) } ?: fp

/** Under this key a pin applies: host and port, without scheme and path. */
fun pinKey(serverUrl: String): String? {
    val url = serverUrl.trim().trimEnd('/').toHttpUrlOrNull() ?: return null
    return if (url.isHttps) "${url.host.lowercase()}:${url.port}" else null
}

/** The second pin of a server: the key of its leaf, alongside the pin of the root. */
fun sheetPinKey(schluessel: String): String = "$schluessel#blatt"

/**
 * Does a fingerprint point to a system root (without user CAs)? Such a pin
 * requires a publicly valid, CT-checked chain anyway; any other one from a
 * foreign source (QR code) only counts once typed in.
 */
fun interface SystemRoots {
    fun contains(fingerabdruck: String): Boolean
}

/** The remembered pins: on the device SharedPreferences (DevicesStore), in the test a map. */
interface PinStore {
    fun pin(schluessel: String): String?
    fun rememberPin(schluessel: String, fingerabdruck: String)

    /**
     * Does the pin come from a code just scanned (held, not yet remembered)?
     * Then the server must show exactly that one, even via a public CA.
     */
    fun fromCode(schluessel: String): Boolean = false
}

/**
 * A connection that only the user can decide on. It aborts the
 * handshake before a token goes out; the UI asks
 * ([CertificateQuestion]).
 */
class CertificateUnresolved(
    val schluessel: String,
    val fingerabdruck: String,
    val art: Art,
    /** For [Art.GEAENDERT] and [Art.SCHLUESSEL_NEU]: the remembered pin. */
    val erwartet: String? = null,
    /** The leaf's key; with a yes to the root pin it becomes the second pin. */
    val blatt: String? = null,
    /** Does the system itself check Certificate Transparency (from Android 16, network_security_config)? */
    val ctForced: Boolean = false,
) : CertificateException("Zertifikat von $schluessel nicht bestätigt ($art)") {
    /** Where a yes stores the [fingerabdruck]. */
    val storeKey: String get() = if (art == Art.SCHLUESSEL_NEU) sheetPinKey(schluessel) else schluessel

    /**
     * Does a yes only count with a transcript from a second source? Without CT requirement (Android 11–15)
     * on first contact and on a new server key, yes: otherwise a misissued
     * chain from any public CA plus a tap would suffice. A deviation from the code can never
     * be confirmed.
     */
    val transcriptNeeded: Boolean get() = when (art) {
        Art.CODE_ABWEICHUNG -> false
        Art.ERSTKONTAKT, Art.SCHLUESSEL_NEU -> !ctForced
        Art.UNBEKANNTE_CA, Art.NUTZER_CA, Art.GEAENDERT -> true
    }

    /**
     * From Android 16 a new key under the same public root needs no transcript (the system
     * checked CT), but a single tap must still not move the pin: whoever briefly holds the
     * unlocked phone could confirm an intercepted key. The screen lock confirms it instead.
     */
    val deviceConfirmationNeeded: Boolean get() = art == Art.SCHLUESSEL_NEU && ctForced

    enum class Art {
        /**
         * First contact, the chain is publicly valid: show the fingerprint and have it
         * confirmed, typed in only without CT requirement ([transcriptNeeded]).
         */
        ERSTKONTAKT,
        /** No known authority issued the certificate (self-issued, internal CA). */
        UNBEKANNTE_CA,
        /**
         * Valid only via a user-installed CA (switch on). To be typed in like
         * [UNBEKANNTE_CA]: such a CA is planted by whoever briefly has the device.
         */
        NUTZER_CA,
        /** The server shows a different key than the remembered one. */
        GEAENDERT,
        /**
         * The server shows a different key than the code just scanned. Not to be
         * confirmed: code and server should originate from the same source.
         */
        CODE_ABWEICHUNG,
        /**
         * Same public root, but a different server key than the remembered one
         * (renewal with a new key, or a misissued chain from the same CA).
         * To be typed in as long as the system doesn't require CT ([transcriptNeeded]).
         */
        SCHLUESSEL_NEU,
    }
}

/**
 * What is currently waiting for a decision. The handshake runs on an
 * OkHttp thread; the UI reads this and shows a dialog.
 */
interface CertificateQuestion {
    val offen: StateFlow<CertificateUnresolved?>
    fun melde(frage: CertificateUnresolved)
    /** [deviceConfirmed]: the screen lock was just passed ([CertificateUnresolved.deviceConfirmationNeeded]). */
    fun confirm(pins: PinStore, eingabe: String? = null, deviceConfirmed: Boolean = false): Boolean
    fun verwerfen()

    /** For tests without Hilt. */
    companion object {
        operator fun invoke(): CertificateQuestion = CertificatePrompt()
    }
}

@Singleton
internal class CertificatePrompt @Inject constructor() : CertificateQuestion {
    private val _open = MutableStateFlow<CertificateUnresolved?>(null)
    override val offen: StateFlow<CertificateUnresolved?> = _open.asStateFlow()

    override fun melde(frage: CertificateUnresolved) {
        // An already open dialog stays as it is; several fetches fail at the same time.
        if (_open.value == null) _open.value = frage
    }

    /**
     * Yes: from now on exactly this key applies for this server. Where
     * [CertificateUnresolved.transcriptNeeded] applies, only with [eingabe] from a second
     * source ([Transcript.confirmed]): a tap alone would be exactly what an attacker in
     * between would need. On first contact with a CT requirement, typing it in is optional; whoever
     * does it must type it correctly.
     */
    override fun confirm(pins: PinStore, eingabe: String?, deviceConfirmed: Boolean): Boolean {
        val f = _open.value ?: return false
        if (f.art == CertificateUnresolved.Art.CODE_ABWEICHUNG) return false
        val pruefen = f.transcriptNeeded || f.art == CertificateUnresolved.Art.ERSTKONTAKT && !eingabe.isNullOrBlank()
        if (pruefen && !Transcript.confirmed(eingabe, f.fingerabdruck)) return false
        // Without a screen lock there is nothing to confirm with; then the transcript counts instead.
        if (f.deviceConfirmationNeeded && !deviceConfirmed && !Transcript.confirmed(eingabe, f.fingerabdruck)) return false
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
 * Pinning for the app's own server: if a pin is remembered (QR field `fp` or
 * confirmed first contact), a certificate of the shown chain must carry it,
 * and the chain must be unbroken up to that point — then it is trusted even without
 * a known CA. Without a pin, trust is never silent. Other hosts (image CDN)
 */
// The pinning needs it: it checks the chain via PKIX up to the pin or via
// ChoiceTrust, and rejects whatever the user hasn't confirmed.
@Suppress("CustomX509TrustManager")
class PinTrust(
    /** For the app's own server: [ChoiceTrust], i.e. on request with user CAs. */
    private val kette: X509ExtendedTrustManager,
    private val pins: PinStore,
    /** [pinKey] of the configured server, or null. */
    private val ownServer: () -> String?,
    private val frage: CertificateQuestion,
    /**
     * For all other hosts: only system CAs. The switch for user CAs applies to the
     * app's own server; an image CDN should never accept a corporate or rogue CA.
     */
    private val foreignHosts: X509ExtendedTrustManager,
    /** Roots between which a public pin may silently switch ([CA_FAMILIES]). */
    private val families: Map<String, String> = CA_FAMILIES,
    /** From Android 16 the system checks CT; then a tap suffices for a new server key. */
    private val ctForced: Boolean = false,
) : X509ExtendedTrustManager() {

    private fun schluessel(sitzung: SSLSession?): String? =
        sitzung?.peerHost?.let { "${it.lowercase()}:${sitzung.peerPort}" }

    private fun pruefe(chain: Array<X509Certificate>, schluessel: String?, mit: (X509ExtendedTrustManager) -> Unit) {
        if (schluessel == null) return withoutHost(chain) { mit(foreignHosts) }
        if (chain.isEmpty() || schluessel != ownServer()) return mit(foreignHosts)
        // Without a pin, trust is never silent; what the follow-up question is depends on the chain's status.
        val pin = pins.pin(schluessel) ?: throw situation(chain, mit).let {
            gemeldet(CertificateUnresolved(schluessel, it.fingerabdruck, it.kindWithoutPin, blatt = spkiFingerprint(chain[0]),
                ctForced = ctForced))
        }
        val fromCode = pins.fromCode(schluessel)
        // A pin on a system root only counts via the system check including Certificate
        // Transparency: if the server sends the root along, the comparison would bypass the CT check.
        val publicPin = pin in systemRoots
        if (!publicPin && fitsToPin(chain, pin)) return
        val situation = situation(chain, mit)
        if (carriesPin(situation, pin, publicPin, fromCode)) return if (publicPin) checkSheet(chain[0], schluessel, fromCode) else Unit
        val art = if (fromCode) CertificateUnresolved.Art.CODE_ABWEICHUNG else CertificateUnresolved.Art.GEAENDERT
        throw gemeldet(CertificateUnresolved(schluessel, situation.fingerabdruck, art, erwartet = pin, blatt = spkiFingerprint(chain[0])))
    }

    /** How the chain is valid and what it is anchored to. Public means: only via the system CAs, never via a user CA. */
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
     * A public pin binds to the pinned root or another one from the same operator:
     * without a CT requirement (Android 11–15) any misissued chain from any CA would otherwise suffice.
     * Intermediates (R10 → R11) and roots of a family (ISRG X1 → X2) switch silently;
     * a different operator is treated like a changed key. A code demands exactly its root.
     */
    private fun carriesPin(situation: Kettenlage, pin: String, publicPin: Boolean, fromCode: Boolean): Boolean =
        if (publicPin) situation.oeffentlich && (situation.fingerabdruck == pin || !fromCode && sameOperator(pin, situation.fingerabdruck))
        else situation.viaUserCa && situation.root != null && situation.fingerabdruck == pin

    /**
     * Under a public root, any chain from that CA suffices; the leaf's key
     * narrows it down to this server. If it's missing (older version), it is now remembered;
     * a code from the signed-in screen swaps it without a question, otherwise the app asks.
     */
    private fun checkSheet(blatt: X509Certificate, schluessel: String, fromCode: Boolean) {
        val neu = spkiFingerprint(blatt)
        val gemerkt = pins.pin(sheetPinKey(schluessel))
        if (gemerkt == neu) return
        if (gemerkt == null || fromCode) return pins.rememberPin(sheetPinKey(schluessel), neu)
        throw gemeldet(CertificateUnresolved(schluessel, neu, CertificateUnresolved.Art.SCHLUESSEL_NEU,
            erwartet = gemerkt, ctForced = ctForced))
    }

    /** Both are system roots of the same known family; the O= in the subject is chosen by each CA itself. */
    private fun sameOperator(a: String, b: String): Boolean {
        if (a !in systemRoots || b !in systemRoots) return false
        return families[a]?.let { it == families[b] } ?: false
    }

    /** The system roots by fingerprint: a pin on one of them means „publicly valid“. */
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
     * Without a host (no handshake session, no version with a socket) there is no way to
     * tell whether it's the app's own server. If it has its own pin, the chain must
     * carry it: otherwise a system CA would suffice where the pin demands a specific authority.
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
 * Trust for a server that no longer has to be the configured one: the
 * deferred revocation after a server change. [pin] under [schluessel] applies
 * just as for the app's own server. A deviation asks no one (its own
 * [CertificateQuestion]) and remembers nothing — it only aborts the handshake.
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
 * Does a certificate of the chain carry the pin, and is everything below it
 * validly signed from there? Just finding the pin somewhere in the chain would not suffice:
 * the certificate of an internal CA is public, an attacker could attach it to
 * their own chain.
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
 * May the leaf identify a server? The PKIX check up to the pin does not ask about the
 * purpose; without this check, a certificate for code signing or email would also pass
 * under a pinned, in-house CA. Without an EKU extension, every
 * purpose is allowed (RFC 5280).
 */
internal fun forServer(blatt: X509Certificate): Boolean {
    val purposes = runCatching { blatt.extendedKeyUsage }.getOrElse { return false } ?: return true
    return EKU_SERVER in purposes || EKU_EACH in purposes
}

/**
 * Roots (SPKI-SHA-256, Base64) per operator, between which a public pin switches without
 * asking. Fixed rather than taken from the subject's O=: every CA writes into that whatever it
 * wants. Values computed with openssl from the roots (Mozilla store, 14.11.2026).
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
 * The authority from the trust store that issued the topmost sent certificate
 * (or is it itself). Servers mostly don't send the root along; without this step
 * the pin would be an intermediate, which the CA can replace.
 */
internal fun anker(chain: Array<X509Certificate>, vertraut: Array<X509Certificate>): X509Certificate? {
    val oben = chain.lastOrNull() ?: return null
    return vertraut.firstOrNull {
        it.subjectX500Principal == oben.issuerX500Principal && runCatching { oben.verify(it.publicKey) }.isSuccess
    }
}

/**
 * Has someone copied the fingerprint from a second source (web app,
 * the browser's certificate display)?
 */
internal const val FINGERPRINT_TYPE_IN = 24

/**
 * What a transcript is good for. The dialog says „too short“ differently from „doesn't match“: the
 * web app shows `AB:CD:…`, and whoever copied 24 visible characters including colons only had 16 hex digits.
 */
enum class Transcript {
    LEER, TO_SHORT, FITS_NOT, PASST;

    companion object {
        /** That many hex characters from the end of the fingerprint; colons and spaces don't count. */
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

/** How a chain is valid: only with the system CAs, only via a user CA, or not at all; plus its anchor. */
private class Kettenlage(
    val oeffentlich: Boolean,
    val viaUserCa: Boolean,
    val root: X509Certificate?,
    val fingerabdruck: String,
) {
    /** Without a pin, a question to the human: first contact, user CA, or unknown CA. */
    val kindWithoutPin: CertificateUnresolved.Art get() = when {
        oeffentlich -> CertificateUnresolved.Art.ERSTKONTAKT
        viaUserCa -> CertificateUnresolved.Art.NUTZER_CA
        else -> CertificateUnresolved.Art.UNBEKANNTE_CA
    }
}

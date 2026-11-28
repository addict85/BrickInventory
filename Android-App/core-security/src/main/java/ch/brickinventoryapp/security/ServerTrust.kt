package ch.brickinventoryapp.security

import ch.brickinventoryapp.security.CertificateQuestion.CodeCheck
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

    private fun choice() = if (userAllowed()) withUser.value else system

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        choice().checkServerTrusted(chain, authType, socket)

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        choice().checkServerTrusted(chain, authType, engine)

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) =
        choice().checkServerTrusted(chain, authType)

    // The app doesn't identify itself via a certificate; client checks stay with the system.
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        system.checkClientTrusted(chain, authType, socket)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        system.checkClientTrusted(chain, authType, engine)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
        system.checkClientTrusted(chain, authType)

    override fun getAcceptedIssuers(): Array<X509Certificate> = choice().acceptedIssuers
}

/** SHA-256 over the SubjectPublicKeyInfo, Base64 — the form of the QR field `fp`. */
fun spkiFingerprint(certificate: X509Certificate): String =
    Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(certificate.publicKey.encoded))

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
fun sheetPinKey(key: String): String = "$key#blatt"

/**
 * Does a fingerprint point to a system root (without user CAs)? Such a pin
 * requires a publicly valid, CT-checked chain anyway; any other one from a
 * foreign source (QR code) only counts once typed in.
 */
fun interface SystemRoots {
    fun contains(fingerprint: String): Boolean
}

/** The remembered pins: on the device SharedPreferences (DevicesStore), in the test a map. */
interface PinStore {
    fun pin(key: String): String?
    fun rememberPin(key: String, fingerprint: String)

    /**
     * Does the pin come from a code just scanned (held, not yet remembered)?
     * Then the server must show exactly that one, even via a public CA.
     */
    fun fromCode(key: String): Boolean = false
}

/**
 * A connection that only the user can decide on. It aborts the
 * handshake before a token goes out; the UI asks
 * ([CertificateQuestion]).
 */
class CertificateUnresolved(
    val key: String,
    val fingerprint: String,
    val kind: Kind,
    /** For [Kind.CHANGED] and [Kind.KEY_NEW]: the remembered pin. */
    val expected: String? = null,
    /** The leaf's key; with a yes to the root pin it becomes the second pin. */
    val sheet: String? = null,
) : CertificateException("Zertifikat von $key nicht bestätigt ($kind)") {
    /** Where a yes stores the [fingerprint]. */
    val storeKey: String get() = if (kind == Kind.KEY_NEW) sheetPinKey(key) else key

    /**
     * Does a yes only count with a transcript from a second source? On every API level, yes:
     * that the system enforces Certificate Transparency on the app's own TrustManager path is
     * unproven, so a misissued public chain plus a tap would otherwise suffice. A deviation
     * from the code can never be confirmed.
     */
    val transcriptNeeded: Boolean get() = when (kind) {
        Kind.CODE_MISMATCH -> false
        Kind.FIRST_CONTACT, Kind.KEY_NEW, Kind.UNKNOWN_CA, Kind.USER_CA, Kind.CHANGED -> true
    }

    enum class Kind {
        /** First contact, the chain is publicly valid: the fingerprint is typed in ([transcriptNeeded]). */
        FIRST_CONTACT,
        /** No known authority issued the certificate (self-issued, internal CA). */
        UNKNOWN_CA,
        /**
         * Valid only via a user-installed CA (switch on). To be typed in like
         * [UNKNOWN_CA]: such a CA is planted by whoever briefly has the device.
         */
        USER_CA,
        /** The server shows a different key than the remembered one. */
        CHANGED,
        /**
         * The server shows a different key than the code just scanned. Not to be
         * confirmed: code and server should originate from the same source.
         */
        CODE_MISMATCH,
        /**
         * Same public root, but a different server key than the remembered one
         * (renewal with a new key, or a misissued chain from the same CA).
         * To be typed in like a first contact ([transcriptNeeded]).
         */
        KEY_NEW,
    }
}

/**
 * What is currently waiting for a decision. The handshake runs on an
 * OkHttp thread; the UI reads this and shows a dialog.
 */
interface CertificateQuestion {
    val open: StateFlow<CertificateUnresolved?>
    fun report(question: CertificateUnresolved)
    fun confirm(pins: PinStore, input: String? = null): Boolean

    /**
     * Yes by the certificate code from the web app ([CertificateCode]): the whole fingerprint from a
     * second source, so it counts wherever a transcript would — never for [CertificateUnresolved.Kind.CODE_MISMATCH].
     */
    fun confirmByCode(pins: PinStore, payload: String?): CodeCheck
    fun discard()

    /** What a scanned certificate code says about the certificate in question. */
    enum class CodeCheck {
        /** All 32 bytes equal the presented fingerprint. */
        MATCHES,

        /** A certificate code, but of a different key. */
        FITS_NOT,

        /** Our prefix, but a version or hash this app does not know (newer web app). */
        UNKNOWN_VERSION,

        /** Not a certificate code at all (sign-in code, set barcode, foreign QR). */
        NOT_A_CODE,
    }

    /** The one way to build it, for Hilt and tests alike; the implementation stays internal. */
    companion object {
        operator fun invoke(): CertificateQuestion = CertificatePrompt()
    }
}

internal class CertificatePrompt : CertificateQuestion {
    private val _open = MutableStateFlow<CertificateUnresolved?>(null)
    override val open: StateFlow<CertificateUnresolved?> = _open.asStateFlow()

    override fun report(question: CertificateUnresolved) {
        // An already open dialog stays as it is; several fetches fail at the same time.
        if (_open.value == null) _open.value = question
    }

    /**
     * Yes: from now on exactly this key applies for this server. Where
     * [CertificateUnresolved.transcriptNeeded] applies, only with [input] from a second
     * source ([Transcript.confirmed]): a tap alone would be exactly what an attacker in
     * between would need.
     */
    override fun confirm(pins: PinStore, input: String?): Boolean {
        val f = _open.value ?: return false
        if (f.kind == CertificateUnresolved.Kind.CODE_MISMATCH) return false
        if (f.transcriptNeeded && !Transcript.confirmed(input, f.fingerprint)) return false
        adopt(pins, f)
        return true
    }

    override fun confirmByCode(pins: PinStore, payload: String?): CodeCheck {
        val f = _open.value ?: return CodeCheck.FITS_NOT
        if (f.kind == CertificateUnresolved.Kind.CODE_MISMATCH) return CodeCheck.FITS_NOT
        return CertificateCode.check(payload, f.fingerprint).also { if (it == CodeCheck.MATCHES) adopt(pins, f) }
    }

    private fun adopt(pins: PinStore, f: CertificateUnresolved) {
        pins.rememberPin(f.storeKey, f.fingerprint)
        f.sheet?.let { pins.rememberPin(sheetPinKey(f.key), it) }
        _open.value = null
    }

    override fun discard() {
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
    private val userCaTrust: X509ExtendedTrustManager,
    private val pins: PinStore,
    /** [pinKey] of the configured server, or null. */
    private val ownServer: () -> String?,
    private val question: CertificateQuestion,
    /**
     * For all other hosts: only system CAs. The switch for user CAs applies to the
     * app's own server; an image CDN should never accept a corporate or rogue CA.
     */
    private val foreignHosts: X509ExtendedTrustManager,
    /** Roots between which a public pin may silently switch ([CA_FAMILIES]). */
    private val families: Map<String, String> = CA_FAMILIES,
) : X509ExtendedTrustManager() {

    private fun key(session: SSLSession?): String? =
        session?.peerHost?.let { "${it.lowercase()}:${session.peerPort}" }

    private fun check(chain: Array<X509Certificate>, key: String?, with: (X509ExtendedTrustManager) -> Unit) {
        if (key == null) return withoutHost(chain) { with(foreignHosts) }
        if (chain.isEmpty() || key != ownServer()) return with(foreignHosts)
        // Without a pin, trust is never silent; what the follow-up question is depends on the chain's status.
        val pin = pins.pin(key) ?: throw situation(chain, with).let {
            reported(CertificateUnresolved(key, it.fingerprint, it.kindWithoutPin, sheet = spkiFingerprint(chain[0])))
        }
        val fromCode = pins.fromCode(key)
        // A pin on a system root only counts via the system check including Certificate
        // Transparency: if the server sends the root along, the comparison would bypass the CT check.
        val publicPin = pin in systemRoots
        if (!publicPin && fitsToPin(chain, pin)) return
        val situation = situation(chain, with)
        if (carriesPin(situation, pin, publicPin, fromCode)) return if (publicPin) checkSheet(chain[0], key, fromCode) else Unit
        val kind = if (fromCode) CertificateUnresolved.Kind.CODE_MISMATCH else CertificateUnresolved.Kind.CHANGED
        throw reported(CertificateUnresolved(key, situation.fingerprint, kind, expected = pin, sheet = spkiFingerprint(chain[0])))
    }

    /** How the chain is valid and what it is anchored to. Public means: only via the system CAs, never via a user CA. */
    private fun situation(chain: Array<X509Certificate>, with: (X509ExtendedTrustManager) -> Unit): ChainState {
        val public = runCatching { with(foreignHosts) }.isSuccess
        val viaUserCa = !public && runCatching { with(userCaTrust) }.isSuccess
        val root = when {
            public -> anchor(chain, foreignHosts.acceptedIssuers)
            viaUserCa -> anchor(chain, userCaTrust.acceptedIssuers)
            else -> null
        }
        return ChainState(public, viaUserCa, root, spkiFingerprint(root ?: chain.last()))
    }

    /**
     * A public pin binds to the pinned root or another one from the same operator:
     * otherwise any misissued chain from any public CA would suffice (CT is not proven on this path).
     * Intermediates (R10 → R11) and roots of a family (ISRG X1 → X2) switch silently;
     * a different operator is treated like a changed key. A code demands exactly its root.
     */
    private fun carriesPin(situation: ChainState, pin: String, publicPin: Boolean, fromCode: Boolean): Boolean =
        if (publicPin) situation.public && (situation.fingerprint == pin || !fromCode && sameOperator(pin, situation.fingerprint))
        else situation.viaUserCa && situation.root != null && situation.fingerprint == pin

    /**
     * Under a public root, any chain from that CA suffices; the leaf's key
     * narrows it down to this server. If it's missing (older version), it is now remembered;
     * a code from the signed-in screen swaps it without a question, otherwise the app asks.
     */
    private fun checkSheet(sheet: X509Certificate, key: String, fromCode: Boolean) {
        val newValue = spkiFingerprint(sheet)
        val wanted = pins.pin(sheetPinKey(key))
        if (wanted == newValue) return
        if (wanted == null || fromCode) return pins.rememberPin(sheetPinKey(key), newValue)
        throw reported(CertificateUnresolved(key, newValue, CertificateUnresolved.Kind.KEY_NEW,
            expected = wanted))
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

    private fun reported(f: CertificateUnresolved): CertificateUnresolved = f.also { question.report(it) }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        check(chain, key((socket as? SSLSocket)?.handshakeSession)) {
            it.checkServerTrusted(chain, authType, socket)
        }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        check(chain, key(engine?.handshakeSession)) { it.checkServerTrusted(chain, authType, engine) }

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
            val root = spkiFingerprint(anchor(chain, foreignHosts.acceptedIssuers) ?: chain.last())
            val sheet = ownServer()?.let { pins.pin(sheetPinKey(it)) }
            val sheetFits = sheet == null || chain.firstOrNull()?.let(::spkiFingerprint) == sheet
            if ((root == pin || sameOperator(pin, root)) && sheetFits) return
        } else if (fitsToPin(chain, pin)) return
        throw CertificateException("Ohne Host kein Abgleich mit dem Pin des eigenen Servers")
    }

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        userCaTrust.checkClientTrusted(chain, authType, socket)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        userCaTrust.checkClientTrusted(chain, authType, engine)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
        userCaTrust.checkClientTrusted(chain, authType)

    override fun getAcceptedIssuers(): Array<X509Certificate> = userCaTrust.acceptedIssuers
}

/**
 * Trust for a server that no longer has to be the configured one: the
 * deferred revocation after a server change. [pin] under [key] applies
 * just as for the app's own server. A deviation asks no one (its own
 * [CertificateQuestion]) and remembers nothing — it only aborts the handshake.
 */
fun trustJob(
    userCaTrust: X509ExtendedTrustManager,
    system: X509ExtendedTrustManager,
    key: String,
    pin: String?,
): PinTrust {
    val job = key
    val store = object : PinStore {
        override fun pin(key: String): String? = pin.takeIf { key == job }
        override fun rememberPin(key: String, fingerprint: String) = Unit
    }
    return PinTrust(userCaTrust, store, ownServer = { job }, question = CertificateQuestion(), foreignHosts = system)
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
        val path = CertificateFactory.getInstance("X.509").generateCertPath(chain.take(i))
        val parameter = PKIXParameters(setOf(TrustAnchor(chain[i], null))).apply { isRevocationEnabled = false }
        CertPathValidator.getInstance("PKIX").validate(path, parameter)
    }.isSuccess
}

/**
 * May the leaf identify a server? The PKIX check up to the pin does not ask about the
 * purpose; without this check, a certificate for code signing or email would also pass
 * under a pinned, in-house CA. Without an EKU extension, every
 * purpose is allowed (RFC 5280).
 */
internal fun forServer(sheet: X509Certificate): Boolean {
    val purposes = runCatching { sheet.extendedKeyUsage }.getOrElse { return false } ?: return true
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
internal fun anchor(chain: Array<X509Certificate>, trusted: Array<X509Certificate>): X509Certificate? {
    val top = chain.lastOrNull() ?: return null
    return trusted.firstOrNull {
        it.subjectX500Principal == top.issuerX500Principal && runCatching { top.verify(it.publicKey) }.isSuccess
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
    EMPTY, TO_SHORT, FITS_NOT, MATCHES;

    companion object {
        /** That many hex characters from the end of the fingerprint; colons and spaces don't count. */
        const val NEEDED = FINGERPRINT_TYPE_IN

        fun confirmed(input: String?, fp: String): Boolean = of(input, fp) == MATCHES

        fun of(input: String?, fp: String): Transcript {
            val raw = input?.trim().orEmpty()
            if (raw.isNotEmpty() && raw == fp) return MATCHES
            val typed = raw.uppercase().filter { it.isLetterOrDigit() }
            return when {
                typed.isEmpty() -> EMPTY
                typed.any { it !in "0123456789ABCDEF" } -> FITS_NOT
                typed.length < FINGERPRINT_TYPE_IN -> TO_SHORT
                fingerprintReadable(fp).replace(":", "").endsWith(typed) -> MATCHES
                else -> FITS_NOT
            }
        }
    }
}

/** How a chain is valid: only with the system CAs, only via a user CA, or not at all; plus its anchor. */
private class ChainState(
    val public: Boolean,
    val viaUserCa: Boolean,
    val root: X509Certificate?,
    val fingerprint: String,
) {
    /** Without a pin, a question to the human: first contact, user CA, or unknown CA. */
    val kindWithoutPin: CertificateUnresolved.Kind get() = when {
        public -> CertificateUnresolved.Kind.FIRST_CONTACT
        viaUserCa -> CertificateUnresolved.Kind.USER_CA
        else -> CertificateUnresolved.Kind.UNKNOWN_CA
    }
}

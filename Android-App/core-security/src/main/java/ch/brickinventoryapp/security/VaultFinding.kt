package ch.brickinventoryapp.security

import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.network.util.AppLog

/**
 * Encryption for the bearer token; the implementation via the Keystore is in
 * TokenVault.kt. Here, without Android classes, so the rules around it run on the JVM.
 */
interface TokenEncryption {
    /** Plaintext → storable string. Throws if the platform can't do it. */
    fun encrypt(plaintext: String): String

    /** Stored string → plaintext, or null if it isn't readable. */
    fun decrypt(saved: String): String?

    /** Like [decrypt], but distinguishes „gone“ from „not right now“. Fakes only know „gone“. */
    fun open(saved: String): VaultFinding =
        decrypt(saved)?.let { VaultFinding.Readable(it) } ?: VaultFinding.Gone

    /** Delete the key itself: whatever it wrapped is afterwards no longer readable anywhere. */
    fun forgetNow() = Unit

    /** Is [saved] under a weaker key or format than [encrypt] would use now? */
    fun stale(saved: String): Boolean = false

    /** After re-encrypting: the legacy key has nothing left to open and is dropped. */
    fun forgetLegacyStock() = Unit
}

/** Is the device currently locked? On the device the KeyguardManager, in the test a value. */
fun interface DeviceLock {
    fun locked(): Boolean
}

/**
 * The token under a key that only works while the device is unlocked ([onlyUnlocked]):
 * whoever reads out a locked device gets the ciphertext, but no plaintext. If it
 * can't encrypt, it throws; a weaker fallback would be exactly what a locked
 * device would expose. [legacyStock] only still reads what earlier versions without a condition
 * stored, until the next unlock re-encrypts it (TokenStore.levelTokenHigh).
 */
class UnlockVault(
    private val onlyUnlocked: TokenEncryption,
    private val legacyStock: TokenEncryption,
) : TokenEncryption {
    override fun encrypt(plaintext: String): String = UNLOCKED_PREFIX + onlyUnlocked.encrypt(plaintext)

    override fun decrypt(saved: String): String? = (open(saved) as? VaultFinding.Readable)?.plaintext

    override fun open(saved: String): VaultFinding =
        if (saved.startsWith(UNLOCKED_PREFIX)) onlyUnlocked.open(saved.removePrefix(UNLOCKED_PREFIX))
        else legacyStock.open(saved)

    override fun stale(saved: String): Boolean =
        !saved.startsWith(UNLOCKED_PREFIX) || onlyUnlocked.stale(saved.removePrefix(UNLOCKED_PREFIX))

    override fun forgetLegacyStock() = legacyStock.forgetNow()

    override fun forgetNow() {
        onlyUnlocked.forgetNow()
        legacyStock.forgetNow()
    }
}

/** Base64 doesn't know a colon: ciphertexts without this prefix come from the key without a condition (legacy data). */
internal const val UNLOCKED_PREFIX = "e1:"

/** What came out of opening the token. */
sealed interface VaultFinding {
    data class Readable(val plaintext: String) : VaultFinding

    /** Key gone or ciphertext unusable: this token is not coming back. */
    data object Gone : VaultFinding

    /** The Keystore just isn't answering right now (startup, StrongBox); the token is still there. */
    data object LockedState : VaultFinding
}

/**
 * Only these errors mean „token gone“: wrong key or corrupted
 * ciphertext (AEADBadTag is a BadPadding), a key that became invalid or
 * unreadable, unreadable Base64. Everything else may succeed on the next
 * attempt and must not trigger a sign-out.
 */
internal fun vaultErrorPermanent(e: Throwable): Boolean = when (e) {
    is javax.crypto.BadPaddingException -> true
    is android.security.keystore.KeyPermanentlyInvalidatedException -> true
    is java.security.UnrecoverableKeyException -> true
    is IllegalArgumentException -> true
    else -> false
}

/** One attempt and, on a temporary error, exactly one second one. */
internal fun openWithRetry(attempt: () -> String?): VaultFinding {
    repeat(2) {
        catchUnlessCancelled { attempt() }
            .onSuccess { return it?.let { VaultFinding.Readable(it) } ?: VaultFinding.Gone }
            .onFailure { if (vaultErrorPermanent(it)) return VaultFinding.Gone }
    }
    return VaultFinding.LockedState
}

/** Pauses at startup: together under the watchdog's wait time (TokenStore.waitOnStart). */
internal val VAULT_ATTEMPT_MS = listOf(250L, 750L, 2_000L)

/** After that it keeps going in the background, at most ten minutes; the next start tries again. */
internal const val VAULT_FOLLOW_UP_MS = 30_000L
internal const val VAULT_FOLLOW_UP_ATTEMPTS = 20

/**
 * The token from the store for [report]. A locked Keystore reports „no token“ once
 * right after startup — the sign-in screen instead of a hanging start —,
 * but deletes nothing, and reports the token afterwards once it can be opened.
 * [old]: the plaintext from a version before encryption.
 */
suspend fun readToken(
    vault: TokenEncryption,
    secret: String?,
    old: String?,
    report: suspend (String) -> Unit,
    wait: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
    lock: DeviceLock = DeviceLock { false },
) {
    if (secret == null) return report(old ?: "")
    readPatient({ vault.open(secret) }, old, report, wait, lock)
}

/**
 * Like [readToken] for every value under a key that only works unlocked (also
 * address and name of the TokenStore): [open] per attempt, [old] on „gone“.
 */
suspend fun readPatient(
    open: () -> VaultFinding,
    old: String?,
    report: suspend (String) -> Unit,
    wait: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
    lock: DeviceLock = DeviceLock { false },
) {
    var attempt = 0
    var emptyReported = false
    while (true) {
        when (val b = open()) {
            is VaultFinding.Readable -> return report(b.plaintext)
            VaultFinding.Gone -> return report(old ?: "")
            VaultFinding.LockedState -> {
                if (attempt >= VAULT_ATTEMPT_MS.size && !emptyReported) {
                    AppLog.warning("Tresor", "Keystore gesperrt; Token bleibt, neuer Versuch im Hintergrund")
                    report(old ?: "")
                    emptyReported = true
                }
                if (attempt >= VAULT_ATTEMPT_MS.size + VAULT_FOLLOW_UP_ATTEMPTS) return
                wait(VAULT_ATTEMPT_MS.getOrElse(attempt) { VAULT_FOLLOW_UP_MS })
                // With the device locked, the key only becomes available again after unlocking:
                // that time doesn't count, otherwise the session would be gone after a night.
                if (attempt < VAULT_ATTEMPT_MS.size || !lock.locked()) attempt++
            }
        }
    }
}

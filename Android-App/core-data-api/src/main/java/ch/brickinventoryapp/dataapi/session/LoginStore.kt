package ch.brickinventoryapp.dataapi.session

/**
 * What the sign-in stores on the device: server address, token, username and the
 * pin from the QR code. On the device the [AccountStore]; the interface lets
 * the sign-in be checked without DataStore.
 */
interface LoginStore {
    suspend fun serverUrlNow(): String
    /** An address with a different origin discards the token (it belongs to the old server). */
    suspend fun saveServerUrl(url: String)
    suspend fun saveAuthToken(token: String)
    suspend fun saveUsername(name: String)
    /** Permanently (util/ServerTrust.kt); replaces a held one. */
    fun rememberPin(key: String, fingerprint: String)
    /** The permanently remembered pin, without a currently held one. */
    fun rememberedPin(key: String): String?
    /**
     * Pin from a QR code only for the current connection setup: only a
     * successful sign-in shows that code and server belong together.
     */
    fun holdBefore(key: String, fingerprint: String)
    fun forgetRetained(key: String)

    /**
     * For a QR pairing with another server while still signed in:
     * requests go to [url] without the previous one's token; its address and token
     * stay until the pairing succeeds. null ends it.
     */
    fun pairingTarget(url: String?)
}

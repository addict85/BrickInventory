package ch.brickinventoryapp.model.address

/**
 * Why setup refuses a server address. Credentials, line breaks, `\`, `?` or `#` can make an
 * address look like it points at one server and lead to another; a server address needs
 * none of that.
 */
enum class AddressError { UNREADABLE, PLAINTEXT, USER_INPUT, EXTRA }

/**
 * What the app understands under an address, for confirmation: host in ASCII (punycode),
 * because a Cyrillic "і" is indistinguishable from "i" in the Unicode rendering.
 * [international]: the host contains an `xn--` label.
 */
data class AddressView(val host: String, val address: String, val international: Boolean)

/**
 * The address rules the screens apply: which server address setup accepts and which links
 * leave the app. An interface so the areas do not know the network layer that parses them;
 * the app provides the implementation (core-network's NetworkAddressRules).
 */
interface AddressRules {
    /** Debug builds also reach the emulator's and the developer's machine over http. */
    val development: Boolean

    /** Input without a scheme counts as https: "nas.fritz.box" means https://nas.fritz.box. */
    fun normalize(input: String): String

    /** Null means: setup accepts the address. */
    fun addressError(serverUrl: String, development: Boolean = this.development): AddressError?

    fun view(serverUrl: String): AddressView?

    /** A stored http address from before the plain-text ban: setup explains the move to https. */
    fun plaintextLegacyStock(serverUrl: String, development: Boolean = this.development): Boolean

    /** Scheme, host and port equal: the origin a token is bound to. */
    fun sameOrigin(a: String, b: String): Boolean

    /** The same origin and base path: the same application on the server. */
    fun sameServer(a: String, b: String): Boolean

    /** What may go to a foreign app (browser): https only, otherwise null. */
    fun external(url: String?): String?

    /** A path on our own server as a full address, only if it stays under the server's base path. */
    fun own(serverUrl: String, path: String): String?

    /** Does the in-app viewer load this address? Only from our own server. */
    fun inViewer(pdfUrl: String, serverUrl: String): Boolean
}

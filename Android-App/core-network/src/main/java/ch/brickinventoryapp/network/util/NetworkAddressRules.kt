package ch.brickinventoryapp.network.util

import ch.brickinventoryapp.model.address.AddressError
import ch.brickinventoryapp.model.address.AddressRules
import ch.brickinventoryapp.model.address.AddressView

/** The areas' address rules are the guard's: one parser decides what setup accepts and what the guard sends. */
object NetworkAddressRules : AddressRules {
    override val development: Boolean get() = NetworkPolicy.development
    override fun normalize(input: String): String = NetworkPolicy.normalize(input)
    override fun addressError(serverUrl: String, development: Boolean): AddressError? =
        NetworkPolicy.addressError(serverUrl, development)
    override fun view(serverUrl: String): AddressView? = NetworkPolicy.view(serverUrl)
    override fun plaintextLegacyStock(serverUrl: String, development: Boolean): Boolean =
        NetworkPolicy.plaintextLegacyStock(serverUrl, development)
    override fun sameOrigin(a: String, b: String): Boolean = NetworkPolicy.sameOrigin(a, b)
    override fun sameServer(a: String, b: String): Boolean = NetworkPolicy.sameServer(a, b)
    override fun external(url: String?): String? = externalAddress(url)
    override fun own(serverUrl: String, path: String): String? = ownAddress(serverUrl, path)
    override fun inViewer(pdfUrl: String, serverUrl: String): Boolean = pdfInViewer(pdfUrl, serverUrl)
}

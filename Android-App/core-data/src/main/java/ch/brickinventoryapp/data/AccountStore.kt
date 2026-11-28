package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.CurrencyCode
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

/**
 * Sign-in and session need token and device together: address and token from the
 * [TokenStore], design, currency and pins from the [DevicesStore]. The two stores
 * stay separate; only these interfaces see them together.
 */
internal class AccountStore @Inject constructor(
    private val token: TokenStore,
    private val device: DevicesStore,
) : SessionStore, LoginStore {
    override val serverUrl: Flow<String> get() = token.serverUrl
    override val authToken: Flow<String> get() = token.authToken
    override val appTheme: Flow<Design> get() = device.appTheme
    override val currency: Flow<CurrencyCode> get() = device.currency
    override val language: Flow<String> get() = device.language
    override suspend fun serverUrlNow(): String = token.serverUrlNow()
    override suspend fun tokenNow(): String = token.tokenNow()
    override suspend fun loginExpired(now: Long): Boolean = token.loginExpired(now)
    override suspend fun loginExpiresSoon(now: Long): Boolean = token.loginExpiresSoon(now)
    override suspend fun saveAppTheme(theme: Design) = device.saveAppTheme(theme)
    override suspend fun saveCurrency(cur: CurrencyCode) = device.saveCurrency(cur)
    override fun failedRedemptions(): Set<String> = device.failedRedemptions()
    override fun acknowledgeFailedRedemptions() = device.acknowledgeFailedRedemptions()

    override suspend fun saveServerUrl(url: String) = token.saveServerUrl(url)
    override suspend fun saveAuthToken(token: String) = this.token.saveAuthToken(token)
    override suspend fun saveUsername(name: String) = token.saveUsername(name)
    override fun rememberPin(key: String, fingerprint: String) = device.rememberPin(key, fingerprint)
    override fun rememberedPin(key: String): String? = device.rememberedPin(key)
    override fun holdBefore(key: String, fingerprint: String) = device.holdBefore(key, fingerprint)
    override fun forgetRetained(key: String) = device.forgetRetained(key)
    override fun pairingTarget(url: String?) = token.pairingTarget(url)
}

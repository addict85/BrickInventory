package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

/**
 * Anmeldung und Sitzung brauchen Token und Gerät zusammen: Adresse und Token aus der
 * [TokenAblage], Design, Währung und Pins aus der [DevicesStore]. Die beiden Ablagen
 * bleiben getrennt; nur diese Schnittstellen sehen sie gemeinsam.
 */
internal class AccountStore @Inject constructor(
    private val token: TokenAblage,
    private val geraet: DevicesStore,
) : Sitzungsablage, Anmeldeablage {
    override val serverUrl: Flow<String> get() = token.serverUrl
    override val authToken: Flow<String> get() = token.authToken
    override val appTheme: Flow<Design> get() = geraet.appTheme
    override val currency: Flow<Waehrung> get() = geraet.currency
    override val language: Flow<String> get() = geraet.language
    override suspend fun serverUrlJetzt(): String = token.serverUrlJetzt()
    override suspend fun tokenJetzt(): String = token.tokenJetzt()
    override suspend fun loginExpired(jetzt: Long): Boolean = token.loginExpired(jetzt)
    override suspend fun saveAppTheme(theme: Design) = geraet.saveAppTheme(theme)
    override suspend fun saveCurrency(cur: Waehrung) = geraet.saveCurrency(cur)
    override fun failedRedemptions(): Set<String> = geraet.failedRedemptions()
    override fun acknowledgeFailedRedemptions() = geraet.acknowledgeFailedRedemptions()

    override suspend fun saveServerUrl(url: String) = token.saveServerUrl(url)
    override suspend fun saveAuthToken(token: String) = this.token.saveAuthToken(token)
    override suspend fun saveUsername(name: String) = token.saveUsername(name)
    override fun rememberPin(schluessel: String, fingerabdruck: String) = geraet.rememberPin(schluessel, fingerabdruck)
    override fun rememberedPin(schluessel: String): String? = geraet.rememberedPin(schluessel)
    override fun holdBefore(schluessel: String, fingerabdruck: String) = geraet.holdBefore(schluessel, fingerabdruck)
    override fun forgetRetained(schluessel: String) = geraet.forgetRetained(schluessel)
    override fun kopplungsziel(url: String?) = token.kopplungsziel(url)
}

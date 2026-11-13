package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

/**
 * Anmeldung und Sitzung brauchen Token und Gerät zusammen: Adresse und Token aus der
 * [TokenAblage], Design, Währung und Pins aus der [GeraeteAblage]. Die beiden Ablagen
 * bleiben getrennt; nur diese Schnittstellen sehen sie gemeinsam.
 */
internal class KontoAblage @Inject constructor(
    private val token: TokenAblage,
    private val geraet: GeraeteAblage,
) : Sitzungsablage, Anmeldeablage {
    override val serverUrl: Flow<String> get() = token.serverUrl
    override val authToken: Flow<String> get() = token.authToken
    override val appTheme: Flow<Design> get() = geraet.appTheme
    override val currency: Flow<Waehrung> get() = geraet.currency
    override val language: Flow<String> get() = geraet.language
    override suspend fun serverUrlJetzt(): String = token.serverUrlJetzt()
    override suspend fun tokenJetzt(): String = token.tokenJetzt()
    override suspend fun anmeldungAbgelaufen(jetzt: Long): Boolean = token.anmeldungAbgelaufen(jetzt)
    override suspend fun saveAppTheme(theme: Design) = geraet.saveAppTheme(theme)
    override suspend fun saveCurrency(cur: Waehrung) = geraet.saveCurrency(cur)
    override fun gescheiterteEntwertungen(): Set<String> = geraet.gescheiterteEntwertungen()
    override fun quittiereGescheiterteEntwertungen() = geraet.quittiereGescheiterteEntwertungen()

    override suspend fun saveServerUrl(url: String) = token.saveServerUrl(url)
    override suspend fun saveAuthToken(token: String) = this.token.saveAuthToken(token)
    override suspend fun saveUsername(name: String) = token.saveUsername(name)
    override fun merkePin(schluessel: String, fingerabdruck: String) = geraet.merkePin(schluessel, fingerabdruck)
    override fun gemerkterPin(schluessel: String): String? = geraet.gemerkterPin(schluessel)
    override fun halteVor(schluessel: String, fingerabdruck: String) = geraet.halteVor(schluessel, fingerabdruck)
    override fun vergissVorgehaltenen(schluessel: String) = geraet.vergissVorgehaltenen(schluessel)
    override fun kopplungsziel(url: String?) = token.kopplungsziel(url)
}

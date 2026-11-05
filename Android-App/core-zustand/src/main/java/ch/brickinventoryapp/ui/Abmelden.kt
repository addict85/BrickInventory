package ch.brickinventoryapp.ui

import android.content.Context
import ch.brickinventoryapp.data.Abmeldeweg
import ch.brickinventoryapp.data.Abmeldung
import ch.brickinventoryapp.data.PasswortPflicht
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.di.BrickDispatchers
import ch.brickinventoryapp.di.Dispatcher
import ch.brickinventoryapp.util.fangeAusserAbbruch
import ch.brickinventoryapp.util.raeumeAnleitungenAuf
import ch.brickinventoryapp.util.raeumeKontoDateienAuf
import ch.brickinventoryapp.util.raeumeVertraulichePdfsAuf
import coil3.ImageLoader
import coil3.annotation.ExperimentalCoilApi
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Named
import okhttp3.OkHttpClient

/**
 * Räumt alles weg, was zum Konto gehört, auch API- und Bildspeicher: Sonst sähe
 * der nächste Nutzer auf dem Gerät fremde Daten. Zuerst entwertet der Server den
 * Token; beim Serverwechsel ist das noch der alte Server.
 */
class Abmelden @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    private val prefs: PreferencesManager,
    private val repo: BrickRepository,
    private val passwortPflicht: PasswortPflicht,
    private val zweiterFaktorPflicht: ZweiterFaktorPflicht,
    @param:Named("image") private val bildHttpClient: OkHttpClient,
    private val vorschau: VorschauSpeicher,
    private val imageLoader: ImageLoader,
    private val abmeldehaken: Abmeldehaken,
    private val sitzung: Sitzung,
    private val blickfeld: Blickfeld,
    private val abmeldung: Abmeldung,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : Abmeldevorgang {
    /** Liefert, ob der Server den Token erst später entwertet (aus der Warteschlange). */
    @OptIn(ExperimentalCoilApi::class)
    override suspend fun ausfuehren(): Abmeldeweg? {
        val weg = if (sitzung.state.value.isLoggedIn) abmeldung.amServer() else null
        prefs.clearSession()
        passwortPflicht.erledigt()
        zweiterFaktorPflicht.erledigt()
        repo.clearCache()
        withContext(io) {
            fangeAusserAbbruch { raeumeVertraulichePdfsAuf(ctx.cacheDir) }
            fangeAusserAbbruch { raeumeAnleitungenAuf(ctx.cacheDir) }
            fangeAusserAbbruch { raeumeKontoDateienAuf(ctx.filesDir, ctx.getExternalFilesDir(null)) }
            fangeAusserAbbruch { bildHttpClient.cache?.evictAll() }
            fangeAusserAbbruch { vorschau.leeren() }
        }
        // Speicher zuerst, sonst schreibt Coil beim nächsten Treffer wieder auf die Platte.
        fangeAusserAbbruch {
            imageLoader.memoryCache?.clear()
            imageLoader.diskCache?.clear()
        }
        // Das Widget zeigt sonst die Zahlen des abgemeldeten Kontos weiter.
        fangeAusserAbbruch { abmeldehaken.abgemeldet() }
        sitzung.abgemeldet()
        blickfeld.zuruecksetzen()
        return weg
    }
}

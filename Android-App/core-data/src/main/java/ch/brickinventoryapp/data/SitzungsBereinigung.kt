package ch.brickinventoryapp.data

import android.content.Context
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.repository.KontoDatenLoescher
import ch.brickinventoryapp.di.BildClient
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
import okhttp3.OkHttpClient
import javax.inject.Inject

/** Was beim Abmelden im Gerät liegen bleibt: Token, Pflichten, Listen, Dateien und Bildspeicher. */
fun interface SitzungsBereinigung {
    suspend fun raeumeAuf()
}

/**
 * Räumt alles weg, was zum Konto gehört, auch API- und Bildspeicher: Sonst sähe
 * der nächste Nutzer auf dem Gerät fremde Daten. Hier und nicht in der Oberfläche,
 * weil es Dateien, Netz-Caches und die Ablage berührt.
 */
class GeraeteBereinigung @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    private val prefs: Sitzungsende,
    private val kontoDaten: KontoDatenLoescher,
    private val passwortPflicht: PasswortPflicht,
    private val zweiterFaktorPflicht: ZweiterFaktorPflicht,
    @param:BildClient private val bildHttpClient: OkHttpClient,
    private val vorschau: VorschauSpeicher,
    private val imageLoader: ImageLoader,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : SitzungsBereinigung {
    @OptIn(ExperimentalCoilApi::class)
    override suspend fun raeumeAuf() {
        prefs.clearSession()
        passwortPflicht.erledigt()
        zweiterFaktorPflicht.erledigt()
        kontoDaten.loesche()
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
    }
}

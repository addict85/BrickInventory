package ch.brickinventoryapp.data

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.repository.AccountDataDeleter
import ch.brickinventoryapp.data.di.ImageClient
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.security.Ablageschluessel
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.data.util.raeumeAnleitungenAuf
import ch.brickinventoryapp.data.util.raeumeKontoDateienAuf
import ch.brickinventoryapp.data.util.raeumeVertraulichePdfsAuf
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
internal class DevicesCleanup @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    private val prefs: SessionEnd,
    private val accountData: AccountDataDeleter,
    private val passwordRequired: PasswordRequired,
    private val zweiterFaktorPflicht: SecondFactorRequired,
    @param:ImageClient private val imageHttpClient: OkHttpClient,
    private val vorschau: VorschauSpeicher,
    private val imageLoader: ImageLoader,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
    private val ablage: Ablageschluessel,
) : SitzungsBereinigung {
    @OptIn(ExperimentalCoilApi::class)
    override suspend fun raeumeAuf() {
        prefs.clearSession()
        passwordRequired.erledigt()
        zweiterFaktorPflicht.erledigt()
        accountData.deleteAccountData()
        withContext(io) {
            fangeAusserAbbruch { raeumeVertraulichePdfsAuf(ctx.cacheDir) }
            fangeAusserAbbruch { raeumeAnleitungenAuf(ctx.cacheDir) }
            fangeAusserAbbruch { raeumeKontoDateienAuf(ctx.filesDir, ctx.getExternalFilesDir(null)) }
            fangeAusserAbbruch { imageHttpClient.cache?.evictAll() }
            fangeAusserAbbruch { vorschau.leeren() }
        }
        // Speicher zuerst, sonst schreibt Coil beim nächsten Treffer wieder auf die Platte.
        fangeAusserAbbruch {
            imageLoader.memoryCache?.clear()
            imageLoader.diskCache?.clear()
        }
        // Preisalarme nennen Sets und Preise; die Leiste gehört dem abgemeldeten Konto.
        fangeAusserAbbruch { NotificationManagerCompat.from(ctx).cancelAll() }
        // Zuletzt ein neuer Ablageschlüssel: Reste auf dem Flash sind danach nicht mehr lesbar.
        withContext(io) { fangeAusserAbbruch { ablage.renew() } }
    }
}

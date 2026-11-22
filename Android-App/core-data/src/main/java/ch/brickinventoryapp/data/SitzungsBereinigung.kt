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

/** What stays on the device at sign-out: token, obligations, lists, files and image cache. */
fun interface SitzungsBereinigung {
    suspend fun raeumeAuf()
}

/**
 * Clears away everything that belongs to the account, API and image caches too: otherwise
 * the next user on the device would see foreign data. Here and not in the UI,
 * because it touches files, network caches and the store.
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
        // Memory first, otherwise Coil writes to disk again on the next hit.
        fangeAusserAbbruch {
            imageLoader.memoryCache?.clear()
            imageLoader.diskCache?.clear()
        }
        // Price alerts name sets and prices; the bar belongs to the signed-out account.
        fangeAusserAbbruch { NotificationManagerCompat.from(ctx).cancelAll() }
        // Finally a new store key: remnants on the flash are no longer readable afterwards.
        withContext(io) { fangeAusserAbbruch { ablage.renew() } }
    }
}

package ch.brickinventoryapp.data

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import ch.brickinventoryapp.data.cache.PreviewMemory
import ch.brickinventoryapp.data.di.ImageClient
import ch.brickinventoryapp.data.repository.AccountDataDeleter
import ch.brickinventoryapp.data.util.cleanUpAccountFiles
import ch.brickinventoryapp.data.util.cleanUpConfidentialPdfs
import ch.brickinventoryapp.data.util.cleanUpInstructions
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.security.StoreKey
import coil3.ImageLoader
import coil3.annotation.ExperimentalCoilApi
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import javax.inject.Inject

/** What stays on the device at sign-out: token, obligations, lists, files and image cache. */
fun interface SessionCleanup {
    suspend fun cleanUp()
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
    private val secondFactorRequired: SecondFactorRequired,
    @param:ImageClient private val imageHttpClient: OkHttpClient,
    private val preview: PreviewMemory,
    private val imageLoader: ImageLoader,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
    private val store: StoreKey,
) : SessionCleanup {
    @OptIn(ExperimentalCoilApi::class)
    override suspend fun cleanUp() {
        prefs.clearSession()
        passwordRequired.done()
        secondFactorRequired.done()
        accountData.deleteAccountData()
        withContext(io) {
            catchUnlessCancelled { cleanUpConfidentialPdfs(ctx.cacheDir) }
            catchUnlessCancelled { cleanUpInstructions(ctx.cacheDir) }
            catchUnlessCancelled { cleanUpAccountFiles(ctx.filesDir, ctx.getExternalFilesDir(null)) }
            catchUnlessCancelled { imageHttpClient.cache?.evictAll() }
            catchUnlessCancelled { preview.clearAll() }
        }
        // Memory first, otherwise Coil writes to disk again on the next hit.
        catchUnlessCancelled {
            imageLoader.memoryCache?.clear()
            imageLoader.diskCache?.clear()
        }
        // Price alerts name sets and prices; the bar belongs to the signed-out account.
        catchUnlessCancelled { NotificationManagerCompat.from(ctx).cancelAll() }
        // Finally a new store key: remnants on the flash are no longer readable afterwards.
        withContext(io) { catchUnlessCancelled { store.renew() } }
    }
}

package ch.brickinventoryapp.data.cache

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import java.io.File
import java.security.MessageDigest

/**
 * Whom the local store belongs to: server and session. On the device the TokenStore;
 * the interface keeps the store checkable without DataStore.
 */
fun interface CacheOwner {
    /** Null as long as no server or no token is stored. */
    suspend fun cacheArea(): String?

    /**
     * Server and account, without the token: it changes with the swap (rotation), and
     * the Room store including outbox must survive that. Null like [cacheArea].
     */
    suspend fun accountArea(): String? = cacheArea()

    /** [accountArea] as a flow, for whoever observes it; asked once without an own mirror. */
    fun accountAreaFlow(): Flow<String?> = flow { emit(accountArea()) }
}

/** Name of the area in the store: hashed, so that neither address nor token stand on disk. */
internal fun areaName(area: String): String =
    MessageDigest.getInstance("SHA-256").digest(area.toByteArray()).joinToString("") { "%02x".format(it) }.take(32)

/**
 * The former response cache (`api-*`) has lain fallow since the single store. It
 * held responses of an account; what nobody reads any more should not be left lying around.
 */
internal fun cleanOldResponseStore(vararg folder: File) {
    for (o in folder) o.listFiles()?.filter { it.isDirectory && it.name.startsWith("api-") }?.forEach { it.deleteRecursively() }
}

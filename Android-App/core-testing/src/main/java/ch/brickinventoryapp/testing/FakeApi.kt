package ch.brickinventoryapp.testing

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.data.Sitzungsablage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.Response
import java.lang.reflect.Proxy
import java.util.Collections

/**
 * The API without a network: every method answers immediately from [antworten] (by
 * method name), otherwise with 404. Without threads and wait time, so a
 * StandardTestDispatcher can drive a ViewModel's whole flow in virtual time.
 */
class FakeApi {
    val antworten: MutableMap<String, Any> = Collections.synchronizedMap(mutableMapOf())

    /** A deviating status code per method, e.g. 500 for „server broken“. */
    val codes: MutableMap<String, Int> = Collections.synchronizedMap(mutableMapOf())
    val calls: MutableList<String> = Collections.synchronizedList(mutableListOf())

    /** The arguments per call (without the continuation), for „with which filter“. */
    val arguments: MutableList<Pair<String, List<Any?>>> = Collections.synchronizedList(mutableListOf())

    val api: BrickApiService = Proxy.newProxyInstance(
        BrickApiService::class.java.classLoader, arrayOf(BrickApiService::class.java),
    ) { proxy, methode, args ->
        when (methode.name) {
            "toString" -> "FakeApi"
            "hashCode" -> System.identityHashCode(proxy)
            "equals" -> proxy === args?.firstOrNull()
            else -> {
                arguments += methode.name to args?.filterNot { it is kotlin.coroutines.Continuation<*> }.orEmpty()
                antwort(methode.name)
            }
        }
    } as BrickApiService

    fun callsOf(methode: String): Int = synchronized(calls) { calls.count { it == methode } }

    private fun antwort(methode: String): Response<Any> {
        calls += methode
        val rumpf = antworten[methode]
        val code = codes[methode] ?: if (rumpf != null) 200 else 404
        return if (code in 200..299 && rumpf != null) Response.success(code, rumpf)
        else Response.error(code, """{"success":false}""".toResponseBody("application/json".toMediaType()))
    }
}

/** The in-memory session store; what the AppViewModel remembers lives in the flows. */
class StorageSessionStore : Sitzungsablage {
    val server = MutableStateFlow("")
    val token = MutableStateFlow("")
    val design = MutableStateFlow(Design.DEFAULT)
    val waehrung = MutableStateFlow(Waehrung.EUR)
    val sprache = MutableStateFlow("system")
    var abgelaufen = false
    var laeuftBaldAb = false
    val gescheitert: MutableSet<String> = mutableSetOf()

    override val serverUrl: Flow<String> = server
    override val authToken: Flow<String> = token
    override val appTheme: Flow<Design> = design
    override val currency: Flow<Waehrung> = waehrung
    override val language: Flow<String> = sprache
    override suspend fun serverUrlJetzt() = server.value
    override suspend fun tokenJetzt() = token.value
    override suspend fun loginExpired(jetzt: Long) = abgelaufen
    override suspend fun loginExpiresSoon(jetzt: Long) = laeuftBaldAb
    override suspend fun saveAppTheme(theme: Design) { design.value = theme }
    override suspend fun saveCurrency(cur: Waehrung) { waehrung.value = cur }
    override fun failedRedemptions(): Set<String> = gescheitert.toSet()
    override fun acknowledgeFailedRedemptions() = gescheitert.clear()
}

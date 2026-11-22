package ch.brickinventoryapp.data.testing

import ch.brickinventoryapp.data.SessionStore
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.Response
import java.lang.reflect.Proxy
import java.util.Collections

/**
 * The API without a network: every method answers immediately from [responses] (by
 * method name), otherwise with 404. Without threads and wait time, so a
 * StandardTestDispatcher can drive a ViewModel's whole flow in virtual time.
 */
class FakeApi {
    val responses: MutableMap<String, Any> = Collections.synchronizedMap(mutableMapOf())

    /** A deviating status code per method, e.g. 500 for „server broken“. */
    val codes: MutableMap<String, Int> = Collections.synchronizedMap(mutableMapOf())
    val calls: MutableList<String> = Collections.synchronizedList(mutableListOf())

    /** The arguments per call (without the continuation), for „with which filter“. */
    val arguments: MutableList<Pair<String, List<Any?>>> = Collections.synchronizedList(mutableListOf())

    val api: BrickApiService = Proxy.newProxyInstance(
        BrickApiService::class.java.classLoader, arrayOf(BrickApiService::class.java),
    ) { proxy, method, args ->
        when (method.name) {
            "toString" -> "FakeApi"
            "hashCode" -> System.identityHashCode(proxy)
            "equals" -> proxy === args?.firstOrNull()
            else -> {
                arguments += method.name to args?.filterNot { it is kotlin.coroutines.Continuation<*> }.orEmpty()
                response(method.name)
            }
        }
    } as BrickApiService

    fun callsOf(method: String): Int = synchronized(calls) { calls.count { it == method } }

    private fun response(method: String): Response<Any> {
        calls += method
        val body = responses[method]
        val code = codes[method] ?: if (body != null) 200 else 404
        return if (code in 200..299 && body != null) Response.success(code, body)
        else Response.error(code, """{"success":false}""".toResponseBody("application/json".toMediaType()))
    }
}

/** The in-memory session store; what the AppViewModel remembers lives in the flows. */
class StorageSessionStore : SessionStore {
    val server = MutableStateFlow("")
    val token = MutableStateFlow("")
    val design = MutableStateFlow(Design.DEFAULT)
    val currencyState = MutableStateFlow(CurrencyCode.EUR)
    val languageState = MutableStateFlow("system")
    var expired = false
    var expiresSoon = false
    val failed: MutableSet<String> = mutableSetOf()

    override val serverUrl: Flow<String> = server
    override val authToken: Flow<String> = token
    override val appTheme: Flow<Design> = design
    override val currency: Flow<CurrencyCode> = currencyState
    override val language: Flow<String> = languageState
    override suspend fun serverUrlNow() = server.value
    override suspend fun tokenNow() = token.value
    override suspend fun loginExpired(now: Long) = expired
    override suspend fun loginExpiresSoon(now: Long) = expiresSoon
    override suspend fun saveAppTheme(theme: Design) { design.value = theme }
    override suspend fun saveCurrency(cur: CurrencyCode) { currencyState.value = cur }
    override fun failedRedemptions(): Set<String> = failed.toSet()
    override fun acknowledgeFailedRedemptions() = failed.clear()
}

package ch.brickinventoryapp

import ch.brickinventoryapp.data.Sitzungsablage
import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.Response
import java.lang.reflect.Proxy
import java.util.Collections

/**
 * Die Api ohne Netz: Jede Methode antwortet sofort aus [antworten] (nach
 * Methodenname), sonst mit 404. Ohne Threads und Wartezeit, damit ein
 * StandardTestDispatcher den ganzen Ablauf eines ViewModels in virtueller Zeit steuert.
 */
class FakeApi {
    val antworten: MutableMap<String, Any> = Collections.synchronizedMap(mutableMapOf())

    /** Abweichender Statuscode je Methode, z. B. 500 für „Server kaputt“. */
    val codes: MutableMap<String, Int> = Collections.synchronizedMap(mutableMapOf())
    val aufrufe: MutableList<String> = Collections.synchronizedList(mutableListOf())

    val api: BrickApiService = Proxy.newProxyInstance(
        BrickApiService::class.java.classLoader, arrayOf(BrickApiService::class.java),
    ) { proxy, methode, argumente ->
        when (methode.name) {
            "toString" -> "FakeApi"
            "hashCode" -> System.identityHashCode(proxy)
            "equals" -> proxy === argumente?.firstOrNull()
            else -> antwort(methode.name)
        }
    } as BrickApiService

    fun aufrufeVon(methode: String): Int = synchronized(aufrufe) { aufrufe.count { it == methode } }

    private fun antwort(methode: String): Response<Any> {
        aufrufe += methode
        val rumpf = antworten[methode]
        val code = codes[methode] ?: if (rumpf != null) 200 else 404
        return if (code in 200..299 && rumpf != null) Response.success(code, rumpf)
        else Response.error(code, """{"success":false}""".toResponseBody("application/json".toMediaType()))
    }

    /** Alle Repositories über diese Api, mit [cache] als Ablage. */
    fun repo(cache: ResponseCache) = BrickRepository(
        SetsRepository(api, cache), TeileRepository(api, cache), FinanzenRepository(api, cache),
        FigurenRepository(api, cache), HaushaltRepository(api, cache), KontoRepository(api, cache),
        VerwaltungRepository(api, cache), KatalogRepository(api, cache), GutscheineRepository(api, cache), cache,
    )
}

/** Die Sitzungsablage im Speicher; was das AppViewModel merkt, steht in den Flüssen. */
class SpeicherSitzungsablage : Sitzungsablage {
    val server = MutableStateFlow("")
    val token = MutableStateFlow("")
    val design = MutableStateFlow("classic")
    val waehrung = MutableStateFlow("EUR")
    val sprache = MutableStateFlow("system")
    var abgelaufen = false
    val gescheitert: MutableSet<String> = mutableSetOf()

    override val serverUrl: Flow<String> = server
    override val authToken: Flow<String> = token
    override val appTheme: Flow<String> = design
    override val currency: Flow<String> = waehrung
    override val language: Flow<String> = sprache
    override suspend fun serverUrlJetzt() = server.value
    override suspend fun anmeldungAbgelaufen(jetzt: Long) = abgelaufen
    override suspend fun saveAppTheme(theme: String) { design.value = theme }
    override suspend fun saveCurrency(cur: String) { waehrung.value = cur }
    override fun gescheiterteEntwertungen(): Set<String> = gescheitert.toSet()
    override fun quittiereGescheiterteEntwertungen() = gescheitert.clear()
}

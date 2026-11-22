package ch.brickinventoryapp.data

import ch.brickinventoryapp.testing.BrickApiService
import ch.brickinventoryapp.data.api.MinifigsQueryApi
import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.api.FinancesApi
import ch.brickinventoryapp.data.api.DeviceApi
import ch.brickinventoryapp.data.api.VouchersApi
import ch.brickinventoryapp.data.api.HouseholdApi
import ch.brickinventoryapp.data.api.CatalogApi
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.PartsQueryApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.api.ManagementApi
import ch.brickinventoryapp.data.repository.FigurenRepositoryImpl
import ch.brickinventoryapp.data.repository.FinanzenRepositoryImpl
import ch.brickinventoryapp.data.repository.KatalogRepositoryImpl
import ch.brickinventoryapp.data.repository.KontoRepositoryImpl
import ch.brickinventoryapp.data.repository.VerwaltungRepositoryImpl
import ch.brickinventoryapp.data.repository.GutscheineRepositoryImpl
import ch.brickinventoryapp.data.repository.SchrittbindungImpl
import ch.brickinventoryapp.data.repository.HaushaltRepositoryImpl
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import ch.brickinventoryapp.model.json.BrickJson
import java.lang.reflect.Method
import ch.brickinventoryapp.testing.TestApi

/**
 * The interface to the server is split by areas: every repository
 * sees only its own, every address is in exactly one, and Retrofit builds the
 * areas including inherited addresses.
 *
 * Counter-checks:
 *   A  SetsRepository again with `api: BrickApiService` → red “every repository
 *      sees only its area”
 *   B  getMe additionally declared in VouchersApi → red “every address is in
 *      exactly one area”
 *   C  `: BestandsInhaltApi` removed from SetsApi → no longer compiles
 *      (SetsRepository calls getParts) — the inheritance carries
 *
 * Since the split into nine areas:
 *   D  CatalogRepository with `api: AccountApi` → does not compile (unresolved reference
 *      'getCatalogSets' …) — the area is in the type, not only in the name
 *   E  getMinifigs additionally in MinifigsApi → red “every address is in exactly one
 *      area” (Doppelt deklariert: {getMinifigs=2})
 */
class ApiAreasTest {

    private val areas = listOf(AccountApi::class, ManagementApi::class, CatalogApi::class, SetsApi::class,
        PartsApi::class, MinifigsApi::class, HouseholdApi::class, FinancesApi::class, VouchersApi::class,
        PartsQueryApi::class, MinifigsQueryApi::class)

    @Test
    fun `every repository sees only its area`() {
        val erwartet = mapOf(
            KontoRepositoryImpl::class to AccountApi::class.java, VerwaltungRepositoryImpl::class to ManagementApi::class.java,
            KatalogRepositoryImpl::class to CatalogApi::class.java, FigurenRepositoryImpl::class to MinifigsApi::class.java,
            SetsRepositoryImpl::class to SetsApi::class.java,
            TeileRepositoryImpl::class to PartsApi::class.java, HaushaltRepositoryImpl::class to HouseholdApi::class.java,
            FinanzenRepositoryImpl::class to FinancesApi::class.java, GutscheineRepositoryImpl::class to VouchersApi::class.java,
            SchrittbindungImpl::class to DeviceApi::class.java,
        )
        for ((repo, api) in erwartet) {
            // With a default value (Offlineablage) Kotlin generates a second constructor;
            // the area stands first in both.
            val typ = repo.java.constructors.map { it.parameterTypes.first() }.distinct().single()
            assertEquals(repo.simpleName, api, typ)
        }
    }

    @Test
    fun `every address is in exactly one area`() {
        // Without the helper methods Kotlin generates for default values (…$default).
        fun adressen(m: Array<Method>) = m.filter { '$' !in it.name && !it.isSynthetic }.map { it.name }
        val namen = areas.flatMap { b -> adressen(b.java.declaredMethods) }
        val doppelt = namen.groupingBy { it }.eachCount().filterValues { it > 1 }
        assertTrue("Doppelt deklariert: $doppelt", doppelt.isEmpty())
        assertTrue("Nur ${namen.size} Adressen — Bereiche verloren?", namen.size >= 140)
        assertEquals("Die Summe deckt alle Bereiche", namen.toSet(),
            adressen(BrickApiService::class.java.methods).toSet())
    }

    @Test
    fun `Retrofit builds an area including inherited addresses`() {
        val server = MockWebServer()
        server.enqueue(TestApi.antwort("""{"success":true,"parts":[],"total":0}"""))
        server.start()
        try {
            val sets = Retrofit.Builder().baseUrl(server.url("/"))
                .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
                .build().create(SetsApi::class.java)
            runBlocking { sets.getParts(page = 1, pageSize = 5, setNumber = "75192-1") }
            val pfad = server.takeRequest().path.orEmpty()
            assertTrue(pfad, pfad.startsWith("/api/v1/parts") && "set_number=75192-1" in pfad)
        } finally {
            server.shutdown()
        }
    }
}

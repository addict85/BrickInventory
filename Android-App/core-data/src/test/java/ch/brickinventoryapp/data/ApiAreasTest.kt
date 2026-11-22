package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.account.AccountRepositoryImpl
import ch.brickinventoryapp.data.account.AdminRepositoryImpl
import ch.brickinventoryapp.data.account.HouseholdRepositoryImpl
import ch.brickinventoryapp.data.account.StepBindingImpl
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.api.CatalogApi
import ch.brickinventoryapp.data.api.DeviceApi
import ch.brickinventoryapp.data.api.FinancesApi
import ch.brickinventoryapp.data.api.HouseholdApi
import ch.brickinventoryapp.data.api.ManagementApi
import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.api.MinifigsQueryApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.api.PartsQueryApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.VouchersApi
import ch.brickinventoryapp.data.catalog.CatalogRepositoryImpl
import ch.brickinventoryapp.data.collection.SetsRepositoryImpl
import ch.brickinventoryapp.data.finances.FinancesRepositoryImpl
import ch.brickinventoryapp.data.finances.VouchersRepositoryImpl
import ch.brickinventoryapp.data.parts.FiguresRepositoryImpl
import ch.brickinventoryapp.data.parts.PartsRepositoryImpl
import ch.brickinventoryapp.data.testing.BrickApiService
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.model.json.BrickJson
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import java.lang.reflect.Method

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
        val expected = mapOf(
            AccountRepositoryImpl::class to AccountApi::class.java, AdminRepositoryImpl::class to ManagementApi::class.java,
            CatalogRepositoryImpl::class to CatalogApi::class.java, FiguresRepositoryImpl::class to MinifigsApi::class.java,
            SetsRepositoryImpl::class to SetsApi::class.java,
            PartsRepositoryImpl::class to PartsApi::class.java, HouseholdRepositoryImpl::class to HouseholdApi::class.java,
            FinancesRepositoryImpl::class to FinancesApi::class.java, VouchersRepositoryImpl::class to VouchersApi::class.java,
            StepBindingImpl::class to DeviceApi::class.java,
        )
        for ((repo, api) in expected) {
            // With a default value (Offlineablage) Kotlin generates a second constructor;
            // the area stands first in both.
            val type = repo.java.constructors.map { it.parameterTypes.first() }.distinct().single()
            assertEquals(repo.simpleName, api, type)
        }
    }

    @Test
    fun `every address is in exactly one area`() {
        // Without the helper methods Kotlin generates for default values (…$default).
        fun addresses(m: Array<Method>) = m.filter { '$' !in it.name && !it.isSynthetic }.map { it.name }
        val names = areas.flatMap { b -> addresses(b.java.declaredMethods) }
        val double = names.groupingBy { it }.eachCount().filterValues { it > 1 }
        assertTrue("Doppelt deklariert: $double", double.isEmpty())
        assertTrue("Nur ${names.size} Adressen — Bereiche verloren?", names.size >= 140)
        assertEquals("Die Summe deckt alle Bereiche", names.toSet(),
            addresses(BrickApiService::class.java.methods).toSet())
    }

    @Test
    fun `Retrofit builds an area including inherited addresses`() {
        val server = MockWebServer()
        server.enqueue(TestApi.response("""{"success":true,"parts":[],"total":0}"""))
        server.start()
        try {
            val sets = Retrofit.Builder().baseUrl(server.url("/"))
                .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
                .build().create(SetsApi::class.java)
            runBlocking { sets.getParts(page = 1, pageSize = 5, setNumber = "75192-1") }
            val path = server.takeRequest().path.orEmpty()
            assertTrue(path, path.startsWith("/api/v1/parts") && "set_number=75192-1" in path)
        } finally {
            server.shutdown()
        }
    }
}

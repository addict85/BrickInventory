package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.AdminApi
import ch.brickinventoryapp.data.api.BestandsInhaltApi
import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.api.FinanzenApi
import ch.brickinventoryapp.data.api.GutscheineApi
import ch.brickinventoryapp.data.api.HaushaltApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.data.repository.AdminRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit

/**
 * Die Schnittstelle zum Server ist nach Bereichen geteilt: Jedes Repository
 * sieht nur seinen, jede Adresse steht in genau einem, und Retrofit baut die
 * Bereiche samt geerbter Adressen.
 *
 * Gegenproben (29.10.2026, gemessen):
 *   A  SetsRepository wieder mit `api: BrickApiService` → rot „jedes Repository
 *      sieht nur seinen Bereich“
 *   B  getMe zusätzlich in GutscheineApi deklariert → rot „jede Adresse steht in
 *      genau einem Bereich“
 *   C  `: BestandsInhaltApi` an SetsApi entfernt → übersetzt nicht mehr
 *      (SetsRepository ruft getParts) — die Vererbung trägt
 */
class ApiBereicheTest {

    private val bereiche = listOf(AdminApi::class, SetsApi::class, TeileApi::class, HaushaltApi::class,
        FinanzenApi::class, GutscheineApi::class, BestandsInhaltApi::class)

    @Test
    fun `jedes Repository sieht nur seinen Bereich`() {
        val erwartet = mapOf(
            AdminRepository::class to AdminApi::class.java, SetsRepository::class to SetsApi::class.java,
            TeileRepository::class to TeileApi::class.java, HaushaltRepository::class to HaushaltApi::class.java,
            FinanzenRepository::class to FinanzenApi::class.java, GutscheineRepository::class to GutscheineApi::class.java,
        )
        for ((repo, api) in erwartet) {
            val typ = repo.java.constructors.single().parameterTypes.first()
            assertEquals(repo.simpleName, api, typ)
        }
    }

    @Test
    fun `jede Adresse steht in genau einem Bereich`() {
        // Ohne die Hilfsmethoden, die Kotlin für Vorgabewerte erzeugt (…$default).
        fun adressen(m: Array<java.lang.reflect.Method>) = m.filter { '$' !in it.name && !it.isSynthetic }.map { it.name }
        val namen = bereiche.flatMap { b -> adressen(b.java.declaredMethods) }
        val doppelt = namen.groupingBy { it }.eachCount().filterValues { it > 1 }
        assertTrue("Doppelt deklariert: $doppelt", doppelt.isEmpty())
        assertTrue("Nur ${namen.size} Adressen — Bereiche verloren?", namen.size >= 140)
        assertEquals("Die Summe deckt alle Bereiche", namen.toSet(),
            adressen(BrickApiService::class.java.methods).toSet())
    }

    @Test
    fun `Retrofit baut einen Bereich samt geerbter Adressen`() {
        val server = MockWebServer()
        server.enqueue(TestApi.antwort("""{"success":true,"parts":[],"total":0}"""))
        server.start()
        try {
            val sets = Retrofit.Builder().baseUrl(server.url("/"))
                .addConverterFactory(ch.brickinventoryapp.data.api.ApiJson.asConverterFactory("application/json".toMediaType()))
                .build().create(SetsApi::class.java)
            runBlocking { sets.getParts(page = 1, pageSize = 5, setNumber = "75192-1") }
            val pfad = server.takeRequest().path.orEmpty()
            assertTrue(pfad, pfad.startsWith("/api/v1/parts") && "set_number=75192-1" in pfad)
        } finally {
            server.shutdown()
        }
    }
}

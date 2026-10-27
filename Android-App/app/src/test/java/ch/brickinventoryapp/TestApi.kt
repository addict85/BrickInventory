package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.viewmodel.Texte
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit

/** Gemeinsames Gerüst der ViewModel-Tests, die gegen einen Testserver laufen. */
object TestApi {

    /** Dieselbe Json-Konfiguration wie in di/AppModule. */
    fun fuer(server: MockWebServer): BrickApiService {
        val client = OkHttpClient.Builder()
            .readTimeout(2, TimeUnit.SECONDS).connectTimeout(2, TimeUnit.SECONDS).build()
        val json = Json {
            ignoreUnknownKeys = true; isLenient = true
            encodeDefaults = true; coerceInputValues = true
        }
        return Retrofit.Builder()
            .baseUrl(server.url("/"))
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(BrickApiService::class.java)
    }

    fun antwort(rumpf: String, code: Int = 200): MockResponse =
        MockResponse().setResponseCode(code)
            .setHeader("Content-Type", "application/json").setBody(rumpf)

    /** Wartet auf echte Netzantworten; viewModelScope läuft auf dem Test-Main. */
    fun warteBis(was: String, bedingung: () -> Boolean) {
        val ende = System.currentTimeMillis() + 5000
        while (!bedingung()) {
            check(System.currentTimeMillis() < ende) { "Zeitüberschreitung: $was" }
            Thread.sleep(10)
        }
    }
}

/** Gibt die Ressourcennummer zurück — der Test prüft, WELCHER Text kam. */
object NummernTexte : Texte {
    override fun text(id: Int, vararg args: Any?) = "t$id"
    override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id:$anzahl"
    override fun meldung(fehler: Result.Error) = "fehler"
    override fun angemeldet() = true
}

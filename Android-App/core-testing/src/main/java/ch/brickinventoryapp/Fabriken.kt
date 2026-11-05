@file:Suppress("FunctionNaming")

package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.FigurenApi
import ch.brickinventoryapp.data.api.GutscheineApi
import ch.brickinventoryapp.data.api.KontoApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.Offlineablage
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
import ch.brickinventoryapp.util.AblageChiffre
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import java.io.File

// Testvorgaben gehören nicht in die @Inject-Konstruktoren: Dort bekäme, wer ohne Hilt
// baut, still eine flüchtige Ablage. Die Fabriken heissen wie die Klassen, damit ein
// Test `SetsRepository(api, cache)` schreibt; mit allen Argumenten gilt der Konstruktor.

fun SetsRepository(api: SetsApi, cache: ResponseCache) = SetsRepository(api, cache, Offlineablage.fluechtig())

fun TeileRepository(api: TeileApi, cache: ResponseCache) = TeileRepository(api, cache, Offlineablage.fluechtig())

fun FigurenRepository(api: FigurenApi, cache: ResponseCache) = FigurenRepository(api, cache, Offlineablage.fluechtig())

fun GutscheineRepository(api: GutscheineApi, cache: ResponseCache) =
    GutscheineRepository(api, cache, Offlineablage.fluechtig())

fun KontoRepository(api: KontoApi, cache: ResponseCache) = KontoRepository(api, cache, Dispatchers.IO)

@Suppress("LongParameterList")
fun BrickRepository(
    sets: SetsRepository, teile: TeileRepository, finanzen: FinanzenRepository, figuren: FigurenRepository,
    haushalt: HaushaltRepository, konto: KontoRepository, verwaltung: VerwaltungRepository,
    katalog: KatalogRepository, gutscheine: GutscheineRepository, cache: ResponseCache,
) = BrickRepository(sets, teile, finanzen, figuren, haushalt, konto, verwaltung, katalog, gutscheine, cache,
    Offlineablage.fluechtig())

/** Der Antwort-Cache im Wegwerf-Ordner; ohne [io] auf Dispatchers.IO wie im Gerät. */
fun ResponseCache(
    bereichQuelle: suspend () -> String? = { "test" },
    altlast: () -> File? = { null },
    chiffre: AblageChiffre? = null,
    io: CoroutineDispatcher = Dispatchers.IO,
    ordnerQuelle: () -> File,
) = ResponseCache(bereichQuelle, altlast, chiffre, io, ordnerQuelle)

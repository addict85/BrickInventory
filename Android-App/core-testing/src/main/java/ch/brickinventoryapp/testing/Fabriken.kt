@file:Suppress("FunctionNaming")

package ch.brickinventoryapp.testing

import ch.brickinventoryapp.data.api.FigurenApi
import ch.brickinventoryapp.data.api.FinanzenApi
import ch.brickinventoryapp.data.api.GutscheineApi
import ch.brickinventoryapp.data.api.HaushaltApi
import ch.brickinventoryapp.data.api.KatalogApi
import ch.brickinventoryapp.data.api.KontoApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.data.api.VerwaltungApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.data.repository.FigurenRepositoryImpl
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.FinanzenRepositoryImpl
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.data.repository.GutscheineRepositoryImpl
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.HaushaltRepositoryImpl
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.KatalogRepositoryImpl
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.KontoRepositoryImpl
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepositoryImpl
import ch.brickinventoryapp.sicherheit.AblageChiffre
import ch.brickinventoryapp.sicherheit.Vertrauenschiffre
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import java.io.File
import ch.brickinventoryapp.zustand.ui.SitzungsRepository
import kotlinx.coroutines.Job

// Testvorgaben gehören nicht in die @Inject-Konstruktoren: Dort bekäme, wer ohne Hilt
// baut, still eine flüchtige Ablage. Die Fabriken heissen wie die Schnittstellen und
// liefern die Umsetzung gegen eine Api; ein Test schreibt `SetsRepository(api, cache)`.

fun SetsRepository(api: SetsApi, cache: ResponseCache, ablage: Offlineablage = Offlineablage.fluechtig()): SetsRepository =
    SetsRepositoryImpl(api, cache, ablage)

fun TeileRepository(api: TeileApi, cache: ResponseCache, ablage: Offlineablage = Offlineablage.fluechtig()): TeileRepository =
    TeileRepositoryImpl(api, cache, ablage)

fun FigurenRepository(api: FigurenApi, cache: ResponseCache, ablage: Offlineablage = Offlineablage.fluechtig()): FigurenRepository =
    FigurenRepositoryImpl(api, cache, ablage)

fun GutscheineRepository(api: GutscheineApi, cache: ResponseCache): GutscheineRepository =
    GutscheineRepositoryImpl(api, cache, Offlineablage.fluechtig())

fun KontoRepository(api: KontoApi, cache: ResponseCache, io: CoroutineDispatcher = Dispatchers.IO): KontoRepository =
    KontoRepositoryImpl(api, cache, io)

fun FinanzenRepository(api: FinanzenApi, cache: ResponseCache): FinanzenRepository = FinanzenRepositoryImpl(api, cache)

fun HaushaltRepository(api: HaushaltApi, cache: ResponseCache): HaushaltRepository = HaushaltRepositoryImpl(api, cache)

fun VerwaltungRepository(api: VerwaltungApi, cache: ResponseCache): VerwaltungRepository = VerwaltungRepositoryImpl(api, cache)

fun KatalogRepository(api: KatalogApi, cache: ResponseCache): KatalogRepository = KatalogRepositoryImpl(api, cache)

/** Der Antwort-Cache im Wegwerf-Ordner; ohne [io] auf Dispatchers.IO wie im Gerät. */
fun ResponseCache(
    bereichQuelle: suspend () -> String? = { "test" },
    altlast: () -> File? = { null },
    chiffre: AblageChiffre? = null,
    io: CoroutineDispatcher = Dispatchers.IO,
    ordnerQuelle: () -> File,
) = ResponseCache(bereichQuelle, altlast, chiffre, io, ordnerQuelle)

/** Die Vertrauenschiffre der Geräteablage mit festem Schlüssel: Robolectric hat keinen Keystore. */
fun testVertrauenschiffre(schluessel: Byte = 7): Vertrauenschiffre = Vertrauenschiffre { ByteArray(32) { schluessel } }

/**
 * Der SitzungsDienst für Tests von ViewModels, die abmelden lassen: Er zählt nur
 * mit, damit ein Test prüfen kann, ob und wann abgemeldet wurde.
 */
class SitzungsAttrappe(private val beimAbmelden: () -> Unit = {}) : SitzungsRepository {
    var abmeldungen = 0
        private set

    override fun starte() = Unit
    override fun abmelden(): Job {
        abmeldungen++
        beimAbmelden()
        return Job().apply { complete() }
    }
    override fun zweiterFaktorEingerichtet() = Unit
    override fun ladeEinstellungen() = Unit
    override fun ladeMitglieder() = Unit
    override fun ladeLagerorte() = Unit
}

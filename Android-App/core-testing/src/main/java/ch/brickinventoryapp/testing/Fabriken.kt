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
import ch.brickinventoryapp.offline.Ausgang
import ch.brickinventoryapp.offline.AusgangPlaner
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.SpeicherAusgang
import ch.brickinventoryapp.offline.SpeicherBestand
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
// nehmen alle (api, cache), damit `mitRepo(::SetsRepository)` für jede passt — auch
// wo das Repository den Cache nicht braucht.

/** Listen und Ausgang im Speicher, mit festem Bereich; [ausgang] behält der Test, um nachzusehen. */
fun Testablage(bereich: String? = "test", ausgang: Ausgang = SpeicherAusgang(), planer: AusgangPlaner = AusgangPlaner {}) =
    Offlineablage(SpeicherBestand(), ausgang, { bereich }, planer)

fun SetsRepository(api: SetsApi, @Suppress("UNUSED_PARAMETER") cache: ResponseCache, ablage: Offlineablage = Testablage()): SetsRepository =
    SetsRepositoryImpl(api, ablage)

fun TeileRepository(api: TeileApi, @Suppress("UNUSED_PARAMETER") cache: ResponseCache, ablage: Offlineablage = Testablage()): TeileRepository =
    TeileRepositoryImpl(api, ablage)

fun FigurenRepository(api: FigurenApi, @Suppress("UNUSED_PARAMETER") cache: ResponseCache, ablage: Offlineablage = Testablage()): FigurenRepository =
    FigurenRepositoryImpl(api, ablage)

fun GutscheineRepository(api: GutscheineApi, @Suppress("UNUSED_PARAMETER") cache: ResponseCache): GutscheineRepository =
    GutscheineRepositoryImpl(api, Testablage())

fun KontoRepository(
    api: KontoApi,
    @Suppress("UNUSED_PARAMETER") cache: ResponseCache,
    io: CoroutineDispatcher = Dispatchers.IO,
): KontoRepository = KontoRepositoryImpl(api, io)

fun FinanzenRepository(api: FinanzenApi, cache: ResponseCache): FinanzenRepository = FinanzenRepositoryImpl(api, cache)

fun HaushaltRepository(api: HaushaltApi, @Suppress("UNUSED_PARAMETER") cache: ResponseCache): HaushaltRepository =
    HaushaltRepositoryImpl(api)

fun VerwaltungRepository(api: VerwaltungApi, @Suppress("UNUSED_PARAMETER") cache: ResponseCache): VerwaltungRepository =
    VerwaltungRepositoryImpl(api)

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

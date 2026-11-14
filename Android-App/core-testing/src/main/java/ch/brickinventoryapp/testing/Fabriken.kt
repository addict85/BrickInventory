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
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.AlarmRepositoryImpl
import ch.brickinventoryapp.data.repository.MerklisteRepository
import ch.brickinventoryapp.data.repository.MerklisteRepositoryImpl
import ch.brickinventoryapp.data.repository.SetDateienRepository
import ch.brickinventoryapp.data.repository.SetDateienRepositoryImpl
import ch.brickinventoryapp.data.repository.SetKatalogRepository
import ch.brickinventoryapp.data.repository.SetKatalogRepositoryImpl
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepositoryImpl
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.sicherheit.Vertrauenschiffre
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import ch.brickinventoryapp.sitzung.SitzungsRepository
import kotlinx.coroutines.Job

// Testvorgaben gehören nicht in die @Inject-Konstruktoren: Dort bekäme, wer ohne Hilt
// baut, still eine flüchtige Ablage. Die Fabriken heissen wie die Schnittstellen; wer
// eine Ablage braucht, bekommt ohne Angabe eine eigene im Speicher.

/** Listen und Ausgang im Speicher, mit festem Bereich; [ausgang] behält der Test, um nachzusehen. */
fun Testablage(bereich: String? = "test", ausgang: Ausgang = SpeicherAusgang(), planer: AusgangPlaner = AusgangPlaner {}) =
    Offlineablage(SpeicherBestand(), ausgang, { bereich }, planer)

fun SetsRepository(api: SetsApi, ablage: Offlineablage = Testablage()): SetsRepository =
    SetsRepositoryImpl(api, ablage, Wiederholung.EINMAL)

fun MerklisteRepository(api: SetsApi, ablage: Offlineablage = Testablage()): MerklisteRepository =
    MerklisteRepositoryImpl(api, ablage, Wiederholung.EINMAL)

fun AlarmRepository(api: SetsApi, ablage: Offlineablage = Testablage()): AlarmRepository =
    AlarmRepositoryImpl(api, ablage, Wiederholung.EINMAL)

fun SetKatalogRepository(api: SetsApi): SetKatalogRepository =
    SetKatalogRepositoryImpl(api)

fun SetDateienRepository(api: SetsApi): SetDateienRepository =
    SetDateienRepositoryImpl(api)

fun TeileRepository(api: TeileApi, ablage: Offlineablage = Testablage()): TeileRepository =
    TeileRepositoryImpl(api, ablage, Wiederholung.EINMAL)

fun FigurenRepository(api: FigurenApi, ablage: Offlineablage = Testablage()): FigurenRepository =
    FigurenRepositoryImpl(api, ablage, Wiederholung.EINMAL)

fun GutscheineRepository(api: GutscheineApi): GutscheineRepository =
    GutscheineRepositoryImpl(api, Testablage())

fun KontoRepository(
    api: KontoApi,
    io: CoroutineDispatcher = Dispatchers.IO,
): KontoRepository = KontoRepositoryImpl(api, io)

fun FinanzenRepository(api: FinanzenApi, ablage: Offlineablage = Testablage()): FinanzenRepository = FinanzenRepositoryImpl(api, ablage)

fun HaushaltRepository(api: HaushaltApi): HaushaltRepository =
    HaushaltRepositoryImpl(api)

fun VerwaltungRepository(api: VerwaltungApi): VerwaltungRepository =
    VerwaltungRepositoryImpl(api)

fun KatalogRepository(api: KatalogApi, ablage: Offlineablage = Testablage()): KatalogRepository =
    KatalogRepositoryImpl(api, ablage, Wiederholung.EINMAL)

/** Die Sicht über gewählte Konten; mit derselben [ablage] wie die Repositories, damit Schreiben sie neu fragt. */
fun Kontosicht(api: BrickApiService, ablage: Offlineablage = Testablage()): Kontosicht =
    Kontosicht(api, api, api, ablage, Wiederholung.EINMAL)

/** Sets, Teile und Figuren auf einer gemeinsamen [ablage]. */
fun Bestandsabgleich(api: BrickApiService, ablage: Offlineablage): Bestandsabgleich =
    Bestandsabgleich(SetsRepositoryImpl(api, ablage, Wiederholung.EINMAL), MerklisteRepositoryImpl(api, ablage, Wiederholung.EINMAL),
        TeileRepositoryImpl(api, ablage, Wiederholung.EINMAL),
        FigurenRepositoryImpl(api, ablage, Wiederholung.EINMAL), ablage)

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

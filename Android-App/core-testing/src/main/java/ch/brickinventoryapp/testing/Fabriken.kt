@file:Suppress("FunctionNaming")

package ch.brickinventoryapp.testing

import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.api.FinancesApi
import ch.brickinventoryapp.data.api.VouchersApi
import ch.brickinventoryapp.data.api.HouseholdApi
import ch.brickinventoryapp.data.api.CatalogApi
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.api.ManagementApi
import ch.brickinventoryapp.offline.Ausgang
import ch.brickinventoryapp.offline.ExitPlanner
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.StorageExit
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.data.repository.MinifigsRepository
import ch.brickinventoryapp.data.repository.FigurenRepositoryImpl
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.FinanzenRepositoryImpl
import ch.brickinventoryapp.data.repository.VouchersRepository
import ch.brickinventoryapp.data.repository.GutscheineRepositoryImpl
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.HaushaltRepositoryImpl
import ch.brickinventoryapp.data.repository.CatalogRepository
import ch.brickinventoryapp.data.repository.KatalogRepositoryImpl
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.data.repository.KontoRepositoryImpl
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.AlarmRepositoryImpl
import ch.brickinventoryapp.data.repository.WantedRepository
import ch.brickinventoryapp.data.repository.MerklisteRepositoryImpl
import ch.brickinventoryapp.data.repository.SetDateienRepository
import ch.brickinventoryapp.data.repository.SetFilesRepositoryImpl
import ch.brickinventoryapp.data.repository.SetKatalogRepository
import ch.brickinventoryapp.data.repository.SetCatalogRepositoryImpl
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import ch.brickinventoryapp.data.repository.ManagementRepository
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
fun Testablage(bereich: String? = "test", ausgang: Ausgang = StorageExit(), planner: ExitPlanner = ExitPlanner {}) =
    Offlineablage(StorageInventory(), ausgang, { bereich }, planner)

fun testSetsRepository(api: SetsApi, ablage: Offlineablage = Testablage()): SetsRepository =
    SetsRepositoryImpl(api, ablage, Wiederholung.EINMAL)

fun testWantedRepository(api: SetsApi, ablage: Offlineablage = Testablage()): WantedRepository =
    MerklisteRepositoryImpl(api, ablage, Wiederholung.EINMAL)

fun testAlarmRepository(api: SetsApi, ablage: Offlineablage = Testablage()): AlarmRepository =
    AlarmRepositoryImpl(api, ablage, Wiederholung.EINMAL)

fun testSetCatalogRepository(api: SetsApi): SetKatalogRepository =
    SetCatalogRepositoryImpl(api)

fun testSetFilesRepository(api: SetsApi): SetDateienRepository =
    SetFilesRepositoryImpl(api)

fun testPartsRepository(api: PartsApi, ablage: Offlineablage = Testablage()): PartsRepository =
    TeileRepositoryImpl(api, ablage, Wiederholung.EINMAL)

fun testMinifigsRepository(api: MinifigsApi, ablage: Offlineablage = Testablage()): MinifigsRepository =
    FigurenRepositoryImpl(api, ablage, Wiederholung.EINMAL)

fun testVouchersRepository(api: VouchersApi): VouchersRepository =
    GutscheineRepositoryImpl(api, Testablage())

fun testAccountRepository(
    api: AccountApi,
    io: CoroutineDispatcher = Dispatchers.IO,
): AccountRepository = KontoRepositoryImpl(api, io)

fun testFinancesRepository(api: FinancesApi, ablage: Offlineablage = Testablage()): FinancesRepository = FinanzenRepositoryImpl(api, ablage)

fun testHouseholdRepository(api: HouseholdApi, ablage: Offlineablage = Testablage()): HouseholdRepository =
    HaushaltRepositoryImpl(api, ablage)

fun testManagementRepository(api: ManagementApi): ManagementRepository =
    VerwaltungRepositoryImpl(api)

fun testCatalogRepository(api: CatalogApi, ablage: Offlineablage = Testablage()): CatalogRepository =
    KatalogRepositoryImpl(api, ablage, Wiederholung.EINMAL)

/** Die Sicht über gewählte Konten; mit derselben [ablage] wie die Repositories, damit Schreiben sie neu fragt. */
fun testKontosicht(api: BrickApiService, ablage: Offlineablage = Testablage()): Kontosicht =
    Kontosicht(api, api, api, ablage, Wiederholung.EINMAL)

/** Sets, Teile und Figuren auf einer gemeinsamen [ablage]. */
fun testBestandsabgleich(api: BrickApiService, ablage: Offlineablage): Bestandsabgleich =
    Bestandsabgleich(SetsRepositoryImpl(api, ablage, Wiederholung.EINMAL), MerklisteRepositoryImpl(api, ablage, Wiederholung.EINMAL),
        TeileRepositoryImpl(api, ablage, Wiederholung.EINMAL),
        FigurenRepositoryImpl(api, ablage, Wiederholung.EINMAL), ablage)

/** Die Vertrauenschiffre der Geräteablage mit festem Schlüssel: Robolectric hat keinen Keystore. */
fun testVertrauenschiffre(schluessel: Byte = 7): Vertrauenschiffre = Vertrauenschiffre { ByteArray(32) { schluessel } }

/**
 * Der SitzungsDienst für Tests von ViewModels, die abmelden lassen: Er zählt nur
 * mit, damit ein Test prüfen kann, ob und wann abgemeldet wurde.
 */
class SessionFake(private val signOutOn: () -> Unit = {}) : SitzungsRepository {
    var signOuts = 0
        private set

    override fun starte() = Unit
    override fun abmelden(): Job {
        signOuts++
        signOutOn()
        return Job().apply { complete() }
    }
    override fun secondFactorConfigured() = Unit
    override fun ladeEinstellungen() = Unit
    override fun loadMembers() = Unit
    override fun ladeLagerorte() = Unit
}

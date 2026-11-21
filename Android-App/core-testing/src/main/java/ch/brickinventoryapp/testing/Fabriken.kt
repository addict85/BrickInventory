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
import ch.brickinventoryapp.security.Vertrauenschiffre
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import ch.brickinventoryapp.session.SitzungsRepository
import kotlinx.coroutines.Job

// Test defaults don't belong in the @Inject constructors: there, whoever builds without Hilt
// would silently get a transient store. The factories are named like the interfaces; whoever
// needs a store gets their own in memory with no argument given.

/** Lists and outbox in memory, with a fixed scope; the test keeps [ausgang] to check on it. */
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

/** The view over chosen accounts; with the same [ablage] as the repositories, so writing asks it again. */
fun testKontosicht(api: BrickApiService, ablage: Offlineablage = Testablage()): Kontosicht =
    Kontosicht(api, api, api, ablage, Wiederholung.EINMAL)

/** Sets, parts and figures on one shared [ablage]. */
fun testBestandsabgleich(api: BrickApiService, ablage: Offlineablage): Bestandsabgleich =
    Bestandsabgleich(SetsRepositoryImpl(api, ablage, Wiederholung.EINMAL), MerklisteRepositoryImpl(api, ablage, Wiederholung.EINMAL),
        TeileRepositoryImpl(api, ablage, Wiederholung.EINMAL),
        FigurenRepositoryImpl(api, ablage, Wiederholung.EINMAL), ablage)

/** The device store's trust cipher with a fixed key: Robolectric has no Keystore. */
fun testVertrauenschiffre(schluessel: Byte = 7): Vertrauenschiffre = Vertrauenschiffre { ByteArray(32) { schluessel } }

/**
 * The SitzungsDienst for tests of ViewModels that trigger a sign-out: it only
 * counts along, so a test can check whether and when a sign-out happened.
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

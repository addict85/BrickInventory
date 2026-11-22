@file:Suppress("FunctionNaming")

package ch.brickinventoryapp.testing

import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.api.CatalogApi
import ch.brickinventoryapp.data.api.FinancesApi
import ch.brickinventoryapp.data.api.HouseholdApi
import ch.brickinventoryapp.data.api.ManagementApi
import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.VouchersApi
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.data.repository.AccountRepositoryImpl
import ch.brickinventoryapp.data.repository.AccountView
import ch.brickinventoryapp.data.repository.AdminRepositoryImpl
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.AlarmRepositoryImpl
import ch.brickinventoryapp.data.repository.CatalogRepository
import ch.brickinventoryapp.data.repository.CatalogRepositoryImpl
import ch.brickinventoryapp.data.repository.FiguresRepositoryImpl
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.FinancesRepositoryImpl
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.HouseholdRepositoryImpl
import ch.brickinventoryapp.data.repository.ManagementRepository
import ch.brickinventoryapp.data.repository.MinifigsRepository
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.PartsRepositoryImpl
import ch.brickinventoryapp.data.repository.SetCatalogRepository
import ch.brickinventoryapp.data.repository.SetCatalogRepositoryImpl
import ch.brickinventoryapp.data.repository.SetFilesRepository
import ch.brickinventoryapp.data.repository.SetFilesRepositoryImpl
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.data.repository.StockReconciliation
import ch.brickinventoryapp.data.repository.VouchersRepository
import ch.brickinventoryapp.data.repository.VouchersRepositoryImpl
import ch.brickinventoryapp.data.repository.WantedListRepositoryImpl
import ch.brickinventoryapp.data.repository.WantedRepository
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.Outbox
import ch.brickinventoryapp.offline.OutboxPlanner
import ch.brickinventoryapp.offline.OutboxStorage
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.security.TrustCipher
import ch.brickinventoryapp.session.SessionRepository
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job

// Test defaults don't belong in the @Inject constructors: there, whoever builds without Hilt
// would silently get a transient store. The factories are named like the interfaces; whoever
// needs a store gets their own in memory with no argument given.

/** Lists and outbox in memory, with a fixed scope; the test keeps [outbox] to check on it. */
fun TestStore(area: String? = "test", outbox: Outbox = OutboxStorage(), planner: OutboxPlanner = OutboxPlanner {}) =
    OfflineStore(StorageInventory(), outbox, { area }, planner)

fun testSetsRepository(api: SetsApi, store: OfflineStore = TestStore()): SetsRepository =
    SetsRepositoryImpl(api, store, RetryPolicy.ONCE)

fun testWantedRepository(api: SetsApi, store: OfflineStore = TestStore()): WantedRepository =
    WantedListRepositoryImpl(api, store, RetryPolicy.ONCE)

fun testAlarmRepository(api: SetsApi, store: OfflineStore = TestStore()): AlarmRepository =
    AlarmRepositoryImpl(api, store, RetryPolicy.ONCE)

fun testSetCatalogRepository(api: SetsApi): SetCatalogRepository =
    SetCatalogRepositoryImpl(api)

fun testSetFilesRepository(api: SetsApi): SetFilesRepository =
    SetFilesRepositoryImpl(api)

fun testPartsRepository(api: PartsApi, store: OfflineStore = TestStore()): PartsRepository =
    PartsRepositoryImpl(api, store, RetryPolicy.ONCE)

fun testMinifigsRepository(api: MinifigsApi, store: OfflineStore = TestStore()): MinifigsRepository =
    FiguresRepositoryImpl(api, store, RetryPolicy.ONCE)

fun testVouchersRepository(api: VouchersApi): VouchersRepository =
    VouchersRepositoryImpl(api, TestStore())

fun testAccountRepository(
    api: AccountApi,
    io: CoroutineDispatcher = Dispatchers.IO,
): AccountRepository = AccountRepositoryImpl(api, io)

fun testFinancesRepository(api: FinancesApi, store: OfflineStore = TestStore()): FinancesRepository = FinancesRepositoryImpl(api, store)

fun testHouseholdRepository(api: HouseholdApi, store: OfflineStore = TestStore()): HouseholdRepository =
    HouseholdRepositoryImpl(api, store)

fun testManagementRepository(api: ManagementApi): ManagementRepository =
    AdminRepositoryImpl(api)

fun testCatalogRepository(api: CatalogApi, store: OfflineStore = TestStore()): CatalogRepository =
    CatalogRepositoryImpl(api, store, RetryPolicy.ONCE)

/** The view over chosen accounts; with the same [store] as the repositories, so writing asks it again. */
fun testAccountView(api: BrickApiService, store: OfflineStore = TestStore()): AccountView =
    AccountView(api, api, api, store, RetryPolicy.ONCE)

/** Sets, parts and figures on one shared [store]. */
fun testStockReconciliation(api: BrickApiService, store: OfflineStore): StockReconciliation =
    StockReconciliation(SetsRepositoryImpl(api, store, RetryPolicy.ONCE), WantedListRepositoryImpl(api, store, RetryPolicy.ONCE),
        PartsRepositoryImpl(api, store, RetryPolicy.ONCE),
        FiguresRepositoryImpl(api, store, RetryPolicy.ONCE), store)

/** The device store's trust cipher with a fixed key: Robolectric has no Keystore. */
fun testTrustCipher(key: Byte = 7): TrustCipher = TrustCipher { ByteArray(32) { key } }

/**
 * The SessionService for tests of ViewModels that trigger a sign-out: it only
 * counts along, so a test can check whether and when a sign-out happened.
 */
class SessionFake(private val logoutOn: () -> Unit = {}) : SessionRepository {
    var logouts = 0
        private set

    override fun launch() = Unit
    override fun logout(): Job {
        logouts++
        logoutOn()
        return Job().apply { complete() }
    }
    override fun secondFactorConfigured() = Unit
    override fun loadSettings() = Unit
    override fun loadMembers() = Unit
    override fun fetchStorageLocations() = Unit
}

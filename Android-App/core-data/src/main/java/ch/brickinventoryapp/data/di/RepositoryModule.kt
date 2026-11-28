package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.data.account.AccountDataDeleter
import ch.brickinventoryapp.data.account.AccountDataDeletion
import ch.brickinventoryapp.data.account.AccountRepositoryImpl
import ch.brickinventoryapp.data.account.HouseholdRepositoryImpl
import ch.brickinventoryapp.data.account.ManagementRepositoryImpl
import ch.brickinventoryapp.data.account.StepBindingImpl
import ch.brickinventoryapp.data.account.StoreAccountView
import ch.brickinventoryapp.data.catalog.CatalogRepositoryImpl
import ch.brickinventoryapp.data.catalog.SetCatalogRepositoryImpl
import ch.brickinventoryapp.data.collection.AlarmRepositoryImpl
import ch.brickinventoryapp.data.collection.SetFilesRepositoryImpl
import ch.brickinventoryapp.data.collection.SetsRepositoryImpl
import ch.brickinventoryapp.data.collection.WantedRepositoryImpl
import ch.brickinventoryapp.data.finances.FinancesRepositoryImpl
import ch.brickinventoryapp.data.finances.VouchersRepositoryImpl
import ch.brickinventoryapp.data.local.StoreStockReconciliation
import ch.brickinventoryapp.data.parts.MinifigsRepositoryImpl
import ch.brickinventoryapp.data.parts.PartsRepositoryImpl
import ch.brickinventoryapp.data.util.InstructionStore
import ch.brickinventoryapp.dataapi.account.AccountRepository
import ch.brickinventoryapp.dataapi.account.AccountView
import ch.brickinventoryapp.dataapi.account.HouseholdRepository
import ch.brickinventoryapp.dataapi.account.ManagementRepository
import ch.brickinventoryapp.dataapi.catalog.CatalogRepository
import ch.brickinventoryapp.dataapi.catalog.SetCatalogRepository
import ch.brickinventoryapp.dataapi.collection.AlarmRepository
import ch.brickinventoryapp.dataapi.collection.SetFilesRepository
import ch.brickinventoryapp.dataapi.collection.SetsRepository
import ch.brickinventoryapp.dataapi.collection.WantedRepository
import ch.brickinventoryapp.dataapi.finances.FinancesRepository
import ch.brickinventoryapp.dataapi.finances.VouchersRepository
import ch.brickinventoryapp.dataapi.instructions.InstructionFiles
import ch.brickinventoryapp.dataapi.parts.MinifigsRepository
import ch.brickinventoryapp.dataapi.parts.PartsRepository
import ch.brickinventoryapp.dataapi.stock.StockReconciliation
import ch.brickinventoryapp.model.step.StepBinding
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** The repositories as interfaces; whoever needs one does not see the implementation. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class RepositoryModule {
    @Binds abstract fun sets(r: SetsRepositoryImpl): SetsRepository
    @Binds abstract fun wanted(r: WantedRepositoryImpl): WantedRepository
    @Binds abstract fun priceAlarms(r: AlarmRepositoryImpl): AlarmRepository
    @Binds abstract fun setCatalog(r: SetCatalogRepositoryImpl): SetCatalogRepository
    @Binds abstract fun setFiles(r: SetFilesRepositoryImpl): SetFilesRepository
    @Binds abstract fun parts(r: PartsRepositoryImpl): PartsRepository
    @Binds abstract fun finances(r: FinancesRepositoryImpl): FinancesRepository
    @Binds abstract fun minifigs(r: MinifigsRepositoryImpl): MinifigsRepository
    @Binds abstract fun household(r: HouseholdRepositoryImpl): HouseholdRepository
    @Binds abstract fun account(r: AccountRepositoryImpl): AccountRepository
    @Binds abstract fun management(r: ManagementRepositoryImpl): ManagementRepository
    @Binds abstract fun catalog(r: CatalogRepositoryImpl): CatalogRepository
    @Binds abstract fun vouchers(r: VouchersRepositoryImpl): VouchersRepository
    @Binds abstract fun accountData(l: AccountDataDeletion): AccountDataDeleter
    @Binds abstract fun stepBinding(s: StepBindingImpl): StepBinding
    @Binds abstract fun stock(s: StoreStockReconciliation): StockReconciliation
    @Binds abstract fun accountView(v: StoreAccountView): AccountView
    @Binds abstract fun instructionFiles(s: InstructionStore): InstructionFiles
}

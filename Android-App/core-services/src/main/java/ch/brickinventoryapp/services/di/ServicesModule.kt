package ch.brickinventoryapp.services.di

import ch.brickinventoryapp.services.alarm.PriceAlertPass
import ch.brickinventoryapp.services.alarm.PriceAlertRepository
import ch.brickinventoryapp.services.alarm.WorkManagerAlarmPlanner
import ch.brickinventoryapp.data.AlarmPlanner
import ch.brickinventoryapp.services.service.AndroidCsvImportService
import ch.brickinventoryapp.services.service.CsvImportDienst
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** In the services module, because core-data doesn't know its classes; the AlarmPlanner interface stays there. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class ServicesModule {
    @Binds abstract fun csvService(d: AndroidCsvImportService): CsvImportDienst
    @Binds abstract fun alarm(p: WorkManagerAlarmPlanner): AlarmPlanner
    @Binds abstract fun preisalarme(d: PriceAlertPass): PriceAlertRepository
}

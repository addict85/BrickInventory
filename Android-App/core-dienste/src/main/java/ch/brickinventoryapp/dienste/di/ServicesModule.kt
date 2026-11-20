package ch.brickinventoryapp.dienste.di

import ch.brickinventoryapp.dienste.alarm.PriceAlertPass
import ch.brickinventoryapp.dienste.alarm.PriceAlertRepository
import ch.brickinventoryapp.dienste.alarm.WorkManagerAlarmPlanner
import ch.brickinventoryapp.data.AlarmPlanner
import ch.brickinventoryapp.dienste.service.AndroidCsvImportService
import ch.brickinventoryapp.dienste.service.CsvImportDienst
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** Im Modul der Dienste, weil core-data deren Klassen nicht kennt; die Schnittstelle AlarmPlanner bleibt dort. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class ServicesModule {
    @Binds abstract fun csvService(d: AndroidCsvImportService): CsvImportDienst
    @Binds abstract fun alarm(p: WorkManagerAlarmPlanner): AlarmPlanner
    @Binds abstract fun preisalarme(d: PriceAlertPass): PriceAlertRepository
}

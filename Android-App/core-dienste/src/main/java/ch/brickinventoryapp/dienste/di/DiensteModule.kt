package ch.brickinventoryapp.dienste.di

import ch.brickinventoryapp.dienste.alarm.PreisalarmDurchgang
import ch.brickinventoryapp.dienste.alarm.PreisalarmRepository
import ch.brickinventoryapp.dienste.alarm.WorkManagerAlarmPlaner
import ch.brickinventoryapp.data.AlarmPlaner
import ch.brickinventoryapp.dienste.service.AndroidCsvImportDienst
import ch.brickinventoryapp.dienste.service.CsvImportDienst
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** Im Modul der Dienste, weil core-data deren Klassen nicht kennt; die Schnittstelle AlarmPlaner bleibt dort. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class DiensteModule {
    @Binds abstract fun csvDienst(d: AndroidCsvImportDienst): CsvImportDienst
    @Binds abstract fun alarm(p: WorkManagerAlarmPlaner): AlarmPlaner
    @Binds abstract fun preisalarme(d: PreisalarmDurchgang): PreisalarmRepository
}

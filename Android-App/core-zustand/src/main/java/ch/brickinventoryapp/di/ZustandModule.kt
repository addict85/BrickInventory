package ch.brickinventoryapp.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** Texte, Dateizugriff und Filterablage der geteilten Präsentationsschicht. */
@Module
@InstallIn(SingletonComponent::class)
object ZustandModule {

    // Die herausgelösten ViewModels sehen Texte und Dateien nur über diese
    // Schnittstellen — so laufen sie im JVM-Test ohne Context.
    @Provides
    fun provideTexte(t: ch.brickinventoryapp.ui.viewmodel.AppTexte): ch.brickinventoryapp.ui.viewmodel.Texte = t

    @Provides
    fun provideDateiLeser(l: ch.brickinventoryapp.ui.viewmodel.AppDateiLeser): ch.brickinventoryapp.ui.viewmodel.DateiLeser = l

    @Provides
    fun provideAbmeldevorgang(a: ch.brickinventoryapp.ui.Abmelden): ch.brickinventoryapp.ui.Abmeldevorgang = a

    @Provides
    fun provideVorwaermung(v: ch.brickinventoryapp.ui.SammlungVorwaermen): ch.brickinventoryapp.ui.Vorwaermung = v

    @Provides
    fun provideFilterAblage(a: ch.brickinventoryapp.ui.ScopeFilterAblage): ch.brickinventoryapp.ui.FilterAblage = a
}

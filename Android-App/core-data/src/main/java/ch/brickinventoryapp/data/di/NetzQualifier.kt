package ch.brickinventoryapp.data.di

import javax.inject.Qualifier

// Typisierte Qualifier statt benannter Zeichenketten: Ein Tippfehler im Namen übersetzt sonst und
// fällt erst zur Laufzeit auf, und die IDE findet die Nutzer eines Clients nicht.

/** Der Client für die Abrufe des eigenen Servers (Retrofit, Downloads mit Token). */
@Qualifier
@Retention(AnnotationRetention.BINARY)
internal annotation class ApiClient

/** Der Client für Bilder: eigener Dispatcher, HTTP-Zwischenspeicher, Bild-Hosts. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
internal annotation class BildClient

/** Der Client für Server-Sent-Events: ohne Lesezeitlimit. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
internal annotation class SseClient

/** Der blanke Client der Selbstaktualisierung: ohne Token, Server und Sprache. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class UpdateClient

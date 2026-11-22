package ch.brickinventoryapp.data.di

import javax.inject.Qualifier

// Typed qualifiers instead of named strings: a typo in the name otherwise compiles and
// only stands out at runtime, and the IDE does not find the users of a client.

/** The client for the own server's fetches (Retrofit, downloads with token). */
@Qualifier
@Retention(AnnotationRetention.BINARY)
internal annotation class ApiClient

/** The client for images: own dispatcher, HTTP cache, image hosts. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
internal annotation class ImageClient

/** The client for server-sent events: without read timeout. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
internal annotation class SseClient

/** The bare client of the self-update: without token, server and language. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class UpdateClient

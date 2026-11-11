package ch.brickinventoryapp.ui

/**
 * Ein Ziel der unteren Leiste mit gemerkter Rollposition. Ziel und Liste benutzen
 * denselben Schlüssel, damit „Reiter angetippt, oben anfangen“ genau die Position
 * verwirft, die das Ziel gemerkt hat. Die Routen liegen in den Bereichen; die App
 * kennt den Schlüssel nur über diese Schnittstelle.
 */
interface Reiterziel {
    val rollSchluessel: String
}

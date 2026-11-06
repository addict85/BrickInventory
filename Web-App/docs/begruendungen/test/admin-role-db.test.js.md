# Begründungen zu `test/admin-role-db.test.js`

Die ausführlichen Kommentare aus `test/admin-role-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Adminrechte entziehen — an BEIDEN Wegen, mit Wahrheitswerten als Text.

── Warum es diese Datei gibt ───────────────────────────────────────────────
Beide Rollen-Endpunkte lasen den Wunsch mit `is_admin ? 1 : 0`. In
JavaScript ist die ZEICHENKETTE "false" wahr. Am laufenden Endpunkt
nachgestellt, bevor es gemeldet wurde:

  {"is_admin": false}     → HTTP 200, Rechte entzogen      ✓
  {"is_admin": "false"}   → HTTP 200, Rechte NICHT entzogen ⚠
  {"is_admin": "0"}       → HTTP 200, Rechte NICHT entzogen ⚠

Der Admin bekam „erfolgreich" gemeldet und glaubte, jemandem die Rechte
genommen zu haben — sie bestanden weiter. Ein Client, der Wahrheitswerte als
Text schickt (Formulare, manche HTTP-Bibliotheken), trifft das sofort. Der
Selbstschutz („eigene Admin-Rolle kann nicht entfernt werden") hing an
derselben Prüfung und lief mit "false" ebenfalls ins Leere.

Es war das bekannte Muster „dieselbe Lücke an ZWEI Wegen": Webapp
(PUT /api/v1/auth/users/:id/admin) und Android-API
(PUT /api/v1/admin/users/:id/role) hatten beide denselben Fehler.

Den zweiten Weg gibt es nicht mehr. Er hatte nie einen Aufrufer —
nachgemessen über den Browser-Code und die Retrofit-Anmerkungen
(test/api-aufrufer.test.js) —, schaltete dieselbe Rolle aber unter einem
anderen Feldnamen (`role` statt `is_admin`) mit eigener Prüfung. Bei Rechten
ist das die Sorte Doppelung, bei der irgendwann eine Seite großzügiger ist
als die andere. Geprüft wird deshalb jetzt der eine Weg, den es gibt.
```

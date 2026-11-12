# Staging Device Check

Ein Claude-Code-Plugin, das prüft, was ein Jira-Ticket geliefert hat, und zwar auf echten Handys: einem iPhone und
einem Android-Gerät bei BrowserStack, gegen die App des Tickets auf Staging. Am Ende steht ein fertiger Abschnitt für
den Stand-Kommentar des Tickets. Den fügst du selbst ein.

## Installieren

In Claude Code:

```text
/plugin marketplace add nx-solutions-ug/staging-device-check
/plugin install staging-device-check@staging-device-check
```

Du brauchst:

- Google Chrome für die lokale Vorschau;
- deine `browserstack.yml` mit deinem BrowserStack-Zugang;
- das Staging-Passwort;
- Jira-Zugriff in Claude Code (die Atlassian-Verbindung).

## Einrichten (einmal)

```text
/staging-device-check:setup
```

Claude fragt nacheinander:

- die Staging-Adresse;
- wie die App-Adressen gebildet werden;
- deine Projekte;
- den Pfad zu deiner `browserstack.yml`;
- deine Testkonten;
- deine Jira-Seite.

Du brauchst dafür kein Node und kein Terminal: Das Plugin lädt sein eigenes Node selbst herunter (geprüft, ohne
Administrator-Rechte) und legt es in deinen Benutzerordner.

Das Staging-Passwort gibst du **nicht im Chat** ein:

1. Ein kleines Fenster fragt nach dem Passwort. Du tippst es zweimal; beim Tippen siehst du nichts.
2. Gespeichert wird es im Schlüsselbund deines Macs (auf Linux im Passwort-Manager des Desktops).
3. Abbrechen speichert nichts.

Nur wo kein solches Fenster aufgehen kann, etwa auf einem Rechner ohne Bildschirm, zeigt Claude dir einen Befehl für
ein eigenes Terminal-Fenster.

Nach dem ersten Setup startest du Claude Code einmal neu (oder verbindest den Browser über `/mcp` neu), damit der
lokale Browser mit dem neuen Node startet.

Zum Schluss prüft Claude alles und sagt „bereit“ oder nennt, was noch fehlt. Einzelne Werte änderst du später,
indem du das Setup noch einmal aufrufst.

## Ein Test

```text
/tests-e2e ABC-123
```

(Falls `/tests-e2e` nicht gefunden wird: `/staging-device-check:tests-e2e ABC-123`.)

1. Claude liest das Ticket und seinen letzten Stand-Kommentar. Ohne Stand-Kommentar, oder solange dort
   „✖ auf Staging“ steht, gibt es nichts zu testen.
2. Claude nennt die App-Adresse, auf der getestet wird. Du bestätigst sie.
3. Claude schaut sich die Seiten in einem lokalen Browser an. Das kostet keine BrowserStack-Minuten.
4. Bevor Minuten verbraucht werden, siehst du eine Liste und sagst „ja“ oder änderst sie:
   - jede Prüfung;
   - jedes Konto;
   - jede Aktion auf Staging (z. B. „sendet eine Nachricht von Konto A an Konto B“);
   - die Geräte;
   - die geschätzten Minuten.
5. Der Test läuft auf den Geräten, danach zeigt Claude den Abschnitt für den Stand-Kommentar und den Ordner mit den
   Bildern.

Ergebnisse und Bilder liegen in `~/Documents/staging-device-check/<TICKET>/<Datum_Uhrzeit>/`. Claude schreibt nichts
in Jira. Du fügst den Abschnitt ein und hängst die Bilder an.

Nie passiert, auch nicht mit deinem Ja:

- Zahlungen, Käufe, Checkout;
- eine Aktion, die nicht auf der Liste stand;
- eine Mail, die das Staging verlässt.

## Was die Ergebnisse bedeuten

| Ergebnis               | Bedeutung                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **bestanden**          | Gemessen und in Ordnung: Text, Elemente, Maße, Layout-Regeln                                                             |
| **nicht bestanden**    | Gemessen und nicht in Ordnung. Auch eine Prüfung, die ohne Grund übersprungen wurde                                      |
| **zu prüfen (Bild)**   | Das kann nur ein Mensch beurteilen, etwa ob es wie im Entwurf aussieht. Schau dir das genannte Bild an                   |
| **nicht prüfbar hier** | BrowserStack kann das nicht prüfen. Bitte auf deinem eigenen Handy nachsehen                                             |
| **abgebrochen**        | Der Lauf wurde vorher beendet (Strg+C oder „Umgebung nicht gestartet“). Diese Prüfung lief nicht zu Ende — kein Ergebnis |

**Die iPhone-Tastatur:** Auf iPhones öffnet BrowserStack keine Bildschirm-Tastatur.

- Alles, was die Tastatur braucht, steht deshalb auf dem iPhone als „nicht prüfbar hier“, zum Beispiel:
  - ob der Weiter-Knopf über der Tastatur sichtbar bleibt;
  - ob das Eingabefeld dann noch zu sehen ist.
- Die letzte Zeile des Abschnitts nennt, was du auf deinem eigenen iPhone prüfen solltest.
- Auf Android wird die Tastatur geprüft.

## Minuten

Ein Lauf kostet grob 1,5 BrowserStack-Minuten pro Testkonto und Gerät: Alle Prüfungen eines Kontos laufen in einer
Sitzung.

- Über der Grenze pro Lauf (Standard 6 Minuten) fragt Claude vorher nach.
- Bei wenigen verbleibenden Minuten warnt Claude.
- Die verbleibenden Minuten sind eine Schätzung. Genau stehen sie nur im BrowserStack-Dashboard.

## Wenn etwas nicht klappt

- **„Umgebung nicht gestartet“:** Die App-Adresse zeigt die App noch nicht. Öffne den Branch einmal über das
  Staging-Dashboard und starte den Test dann neu. Das Plugin startet keine Umgebungen.
- **Etwas „fehlt“:** `/staging-device-check:setup` aufrufen. Claude geht den fehlenden Schritt mit dir durch.
- **Das Passwort ist im Chat gelandet:** Bitte lass es ändern. Es steht jetzt im Verlauf.

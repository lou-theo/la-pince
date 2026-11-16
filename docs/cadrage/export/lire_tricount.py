"""Exporte un tricount partagé en JSON, en lecture seule, par l'API non officielle de l'app Android.

Usage : python3 -I lire_tricount.py <dossier de sortie> <jeton du lien tricount.com/<jeton>>
Le dossier doit contenir pub.pem, clé publique RSA 2048 au format PKCS1 :
  openssl genrsa -traditional -out key.pem 2048 && openssl rsa -in key.pem -RSAPublicKey_out -out pub.pem
Sortie : <dossier>/registry.json (groupe, membres, opérations avec leur répartition).

Ouvre une session anonyme puis lit le groupe par son jeton ; n'appelle pas registry-synchronization, qui rattacherait la session au premier membre du groupe.
Le serveur refuse les versions d'app trop anciennes (HTTP 422 « Please update your app ») : le User-Agent se relit dans l'APK, classe UserAgentInterceptor (format <paquet>:RELEASE:<version>:<build>:ANDROID:<version Android>:C).
"""
import json, sys, uuid, urllib.request, urllib.error

dossier, jeton = sys.argv[1], sys.argv[2]
BASE = "https://api.tricount.bunq.com"
app_id = str(uuid.uuid4())
headers = {
    # Version 14.8.2 relevée dans l'APK le 16/11/2026.
    "User-Agent": "com.bunq.tricount.android:RELEASE:14.8.2:500004156:ANDROID:14:C",
    "app-id": app_id,
    "X-Bunq-Client-Request-Id": "049bfcdf-6ae4-4cee-af7b-45da31ea85d0",
    "Content-Type": "application/json",
}


def appel(methode, chemin, corps=None):
    req = urllib.request.Request(BASE + chemin, method=methode, headers=headers,
                                 data=json.dumps(corps).encode() if corps is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"{methode} {chemin.split('?')[0]} -> {e.code} {e.read().decode()[:500]}")


pub = open(f"{dossier}/pub.pem").read()
rep = appel("POST", "/v1/session-registry-installation",
            {"app_installation_uuid": app_id, "client_public_key": pub, "device_description": "Android"})
headers["X-Bunq-Client-Authentication"] = next(x["Token"]["token"] for x in rep["Response"] if "Token" in x)
user_id = next(x["UserPerson"]["id"] for x in rep["Response"] if "UserPerson" in x)

data = appel("GET", f"/v1/user/{user_id}/registry?public_identifier_token={jeton}")
json.dump(data, open(f"{dossier}/registry.json", "w"), ensure_ascii=False, indent=1)
reg = data["Response"][0]["Registry"]
print("devise:", reg.get("currency"), "| membres:", len(reg.get("memberships", [])), "| opérations:", len(reg.get("all_registry_entry", [])))

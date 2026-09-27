"""Portable .cozy archives: fixed member names, bounded reads and SHA-256 integrity."""
import hashlib
import json
from pathlib import Path
import stat
import re
import zipfile

from project import TRACK_IDS, validate_project

MAX_PACKAGE_BYTES = 500 * 1024 * 1024
MAX_JSON_BYTES = 2 * 1024 * 1024
CHUNK = 1024 * 1024


def members(project):
    result = {f"media/{kind}" for kind in project["tracks"] if project["tracks"][kind]["source"]}
    if project["background"]["asset"]:
        result.add("media/video")
    elif project["background"]["url"]:
        raise ValueError("Önce bağlantıdaki görüntüyü projeye alın.")
    if project["overlay"]["asset"]:
        result.add("media/overlay")
    elif project["overlay"]["url"]:
        raise ValueError("Ön plan görselini projeye yükleyin.")
    for index, clip in enumerate(project["videoClips"]):
        if not clip["asset"]:
            raise ValueError("Klip kaynağı eksik.")
        result.add(f"media/clip_{index:03d}")
    return result


def build_package(destination, value, files):
    project = validate_project(value)
    expected = members(project)
    if set(files) != expected:
        raise ValueError("Paket için bütün kaynak dosyalarını bağlayın.")
    for kind in project["tracks"]:
        if f"media/{kind}" in files and Path(files[f"media/{kind}"]).stat().st_size != project["tracks"][kind]["source"]["size"]:
            raise ValueError("Ses dosyası boyutu proje kaydıyla eşleşmiyor.")
    encoded = json.dumps(project, ensure_ascii=False).encode("utf-8")
    if len(encoded) > MAX_JSON_BYTES or sum(Path(p).stat().st_size for p in files.values()) + len(encoded) > MAX_PACKAGE_BYTES - 16384:
        raise ValueError("Proje paketi 500 MB sınırını aşıyor.")
    manifest = {"format": "cozy-project", "version": 1, "files": {}}
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("project.json", encoded)
        manifest["files"]["project.json"] = dict(size=len(encoded), sha256=hashlib.sha256(encoded).hexdigest())
        for name, path in files.items():
            digest, size = hashlib.sha256(), 0
            with open(path, "rb") as source, archive.open(name, "w") as output:
                for chunk in iter(lambda: source.read(CHUNK), b""):
                    size += len(chunk); digest.update(chunk); output.write(chunk)
            manifest["files"][name] = dict(size=size, sha256=digest.hexdigest())
        archive.writestr("manifest.json", json.dumps(manifest).encode("utf-8"))
    return project


def unpack_package(source, directory):
    """Never extract archive-controlled paths. Return validated project and local files."""
    try:
        with zipfile.ZipFile(source) as archive:
            infos = archive.infolist()
            names = [i.filename for i in infos]
            allowed = lambda name: name in ("manifest.json", "project.json") or re.fullmatch(r"media/[a-zA-Z0-9_-]{1,64}", name)
            if (len(names) > 101 or len(names) != len(set(names)) or not all(allowed(name) for name in names) or
                    not {"manifest.json", "project.json"} <= set(names)):
                raise ValueError("Paket dosya listesi geçersiz.")
            if sum(i.file_size for i in infos) > MAX_PACKAGE_BYTES:
                raise ValueError("Paketin açılmış boyutu 500 MB sınırını aşıyor.")
            for info in infos:
                if (info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) or
                        stat.S_IFMT(info.external_attr >> 16) not in (0, stat.S_IFREG)):
                    raise ValueError("Paket dosya türü desteklenmiyor.")
                if info.filename.endswith('.json') and info.file_size > MAX_JSON_BYTES:
                    raise ValueError("Paket metadata boyutu geçersiz.")
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("format") != "cozy-project" or type(manifest.get("version")) is not int or manifest["version"] != 1:
                raise ValueError("Desteklenmeyen proje paketi sürümü.")
            entries = manifest["files"]
            if set(entries) != set(names) - {"manifest.json"}:
                raise ValueError("Paket içeriği eksik veya fazla.")
            directory = Path(directory); files = {}; project_bytes = None
            for name, spec in entries.items():
                info = archive.getinfo(name)
                if type(spec["size"]) is not int or spec["size"] != info.file_size or info.file_size <= 0:
                    raise ValueError("Paket dosya boyutu eşleşmiyor.")
                target = directory / ("project.json" if name == "project.json" else name.split("/")[1])
                digest, size = hashlib.sha256(), 0
                with archive.open(name) as entry, target.open("wb") as output:
                    for chunk in iter(lambda: entry.read(CHUNK), b""):
                        size += len(chunk)
                        if size > spec["size"]:
                            raise ValueError("Paket dosya sınırı aşıldı.")
                        digest.update(chunk); output.write(chunk)
                if size != spec["size"] or digest.hexdigest() != spec["sha256"]:
                    raise ValueError("Paket bütünlük kontrolü başarısız.")
                if name == "project.json":
                    project_bytes = target.read_bytes()
                else:
                    files[name] = str(target)
            project = validate_project(json.loads(project_bytes))
            if set(files) != members(project):
                raise ValueError("Paket kaynakları projeyle eşleşmiyor.")
            for kind in project["tracks"]:
                if f"media/{kind}" in files and Path(files[f"media/{kind}"]).stat().st_size != project["tracks"][kind]["source"]["size"]:
                    raise ValueError("Ses kaynağı boyutu eşleşmiyor.")
            return project, files
    except (zipfile.BadZipFile, KeyError, TypeError, AttributeError, UnicodeError, RuntimeError) as exc:
        raise ValueError("Proje paketi okunamadı veya bozuk.") from exc

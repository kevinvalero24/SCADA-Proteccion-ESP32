import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class NodoService {
  // Asegúrate de que el puerto apunte al de tu servidor backend en Node.js
  private apiUrl = 'http://192.168.1.4:3000/api/nodos'; 

  constructor(private http: HttpClient) {}

  // 1. Consulta la lista completa de tableros (ESP32) configurados en MongoDB
  obtenerNodos(): Observable<any> {
    return this.http.get(this.apiUrl);
  }

  // 2. Envía la nueva instrucción de límite de potencia (watts) a la base de datos
  actualizarUmbral(idNodo: string, idCircuito: string, nuevosWatts: number): Observable<any> {
    // Fíjate cómo la URL coincide exactamente con la del router.put en Node.js
    return this.http.put(`${this.apiUrl}/${idNodo}/circuito/${idCircuito}`, {
      alert_threshold_watts: nuevosWatts
    });
  }
}
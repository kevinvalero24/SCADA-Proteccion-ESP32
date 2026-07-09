import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class TelemetriaService {
  // La ruta exacta de las borneras de tu Backend que arreglamos
  private apiUrl = 'http://localhost:3000/api/telemetria/1'; 

  constructor(private http: HttpClient) { }

  // Función para ir a leer el medidor
  obtenerDatosReales(): Observable<any> {
    return this.http.get(this.apiUrl);
  }
}
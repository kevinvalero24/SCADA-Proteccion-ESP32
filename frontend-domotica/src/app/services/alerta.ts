import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AlertaService {
  // Ruta que apunta a nuestro nuevo endpoint del log de eventos
  private apiUrl = 'http://192.168.1.4:3000/api/alertas'; 

  constructor(private http: HttpClient) {}

  // Función para solicitar la sábana de eventos al backend
  obtenerHistorial(): Observable<any> {
    return this.http.get(this.apiUrl);
  }
}
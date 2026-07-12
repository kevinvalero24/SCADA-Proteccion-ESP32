import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class TelemetriaService {
  // 1. Dejamos la ruta base limpia (La bornera principal del servidor)
  private baseUrl = 'http://localhost:3000/api/telemetria';

  constructor(private http: HttpClient) {}

  // 2. Función LENTA (Cada 1 min): Para leer la gráfica histórica en MongoDB
  obtenerDatosReales(): Observable<any> {
    return this.http.get(`${this.baseUrl}/breaker_prueba_01`);
  }

  // 3. ---> NUEVA FUNCIÓN RÁPIDA (Cada 5 seg): Para leer la RAM del servidor <---
  obtenerDatosEnVivo(): Observable<any> {
    return this.http.get(`${this.baseUrl}/envivo/breaker_prueba_01`);
  }

  // 4. Llamado a la ruta de facturación y eficiencia
  obtenerMetricas(): Observable<any> {
    return this.http.get(`${this.baseUrl}/metricas`);
  }

  // 5. Retorna la URL directa para forzar la descarga nativa (También usa la ruta base)
  exportarHistorialCSV(tipo: string): string {
    return `${this.baseUrl}/exportar-csv?tipo=${tipo}`;
  }
}
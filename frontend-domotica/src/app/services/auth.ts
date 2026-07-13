import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = 'http://192.168.1.4:3000/api/auth';

  constructor(private http: HttpClient) {}

  // Intento de arranque de sesion
  login(correo: string, password: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/login`, { correo, password }).pipe(
      tap((respuesta: any) => {
        // Si el servidor aprueba, guardamos el carnet y el nivel de autoridad
        if (respuesta.token) {
          localStorage.setItem('scada_token', respuesta.token);
          localStorage.setItem('scada_rol', respuesta.rol);
        }
      })
    );
  }

  // Cierre de contactor (Cerrar sesion)
  logout(): void {
    localStorage.removeItem('scada_token');
    localStorage.removeItem('scada_rol');
  }

  // Verificacion de estado activo
  estaAutenticado(): boolean {
    return !!localStorage.getItem('scada_token');
  }

  // Obtener jerarquia del operador
  obtenerRol(): string | null {
    return localStorage.getItem('scada_rol');
  }
}
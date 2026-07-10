import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html'
})
export class LoginComponent {
  correo: string = '';
  password: string = '';
  mensajeError: string = '';
  cargando: boolean = false;

  constructor(private authService: AuthService) {}

  iniciarSesion() {
    if (!this.correo || !this.password) {
      this.mensajeError = 'Protocolo denegado: Ingrese sus credenciales.';
      return;
    }

    this.cargando = true;
    this.mensajeError = '';

    this.authService.login(this.correo, this.password).subscribe({
      next: () => {
        // Si el servidor aprueba la llave maestra, recargamos el tablero de golpe
        window.location.reload(); 
      },
      error: (err) => {
        this.cargando = false;
        this.mensajeError = err.error.error || 'Falla de enlace con el servidor central.';
      }
    });
  }
}
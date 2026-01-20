# Uniglade - Bus Ticket Booking System

A modern bus ticket booking system with a RESTful API and CLI interface, featuring real-time cart management, secure purchaser information handling, and comprehensive monitoring.

## Features

- **User Management**
  - JWT-based authentication & authorization
  - Profile management with role-based access
  - Secure password hashing with bcrypt

- **Booking System**
  - Real-time bus search and availability
  - Seat selection and reservation
  - Booking management and history
  - Multi-passenger support

- **Shopping Cart**
  - Session-based cart with Redis caching
  - Real-time cart updates via Socket.IO
  - Cart persistence across sessions
  - Automatic cart expiration

- **Security**
  - Data encryption at rest and in transit
  - Rate limiting and DDoS protection
  - Input validation and sanitization
  - Security headers (CSP, HSTS, XSS)

- **Monitoring & Logging**
  - Prometheus metrics endpoint
  - Structured logging with Winston
  - Request/Response logging
  - Performance monitoring

- **Admin Dashboard**
  - Real-time analytics
  - User management
  - Route management
  - System configuration

## Quick Start

### Prerequisites

- Node.js (v18 or higher recommended)
- MongoDB (v6.0 or higher)
- Redis (v7.0 or higher)
- npm (v9.0 or higher) or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/uniglade.git
   cd uniglade
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   yarn
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   Update the `.env` file with your configuration.

4. **Set up the development environment**
   ```bash
   npm run setup
   ```
   This will create necessary directories and set up initial configuration.

5. **Start the development server**
   ```bash
   npm run dev
   ```
   The API will be available at `http://localhost:5000`

## Configuration

### Environment Variables

See [.env.example](.env.example) for all available configuration options.

Key configurations:
- `NODE_ENV`: Application environment (development, production, test)
- `PORT`: Server port (default: 5000)
- `MONGODB_URI`: MongoDB connection string
- `REDIS_URL`: Redis connection URL
- `JWT_SECRET`: Secret for JWT token signing
- `BUSBUD_API_KEY`: Busbud API key
- `FIREBASE_*`: Firebase configuration

### Database Setup

1. **MongoDB**
   - Create a new database for the application
   - Update `MONGODB_URI` in `.env`

2. **Redis**
   - Install and start Redis server
   - Update `REDIS_URL` in `.env`

## Development

### Available Scripts

- `npm run dev`: Start development server with hot-reload
- `npm run build`: Build for production
- `npm start`: Start production server
- `npm test`: Run tests
- `npm run lint`: Run ESLint
- `npm run format`: Format code with Prettier
- `npm run metrics`: View bundle analysis
- `npm run docker:up`: Start Docker containers
- `npm run docker:down`: Stop Docker containers

### API Documentation

API documentation is available at `/api-docs` when running in development mode.

## Deployment

### Docker

```bash
docker-compose up -d
```

### PM2 (Production)

```bash
npm install -g pm2
npm run build
pm2 start dist/server.js --name "uniglade"
```

## Documentation

- [API Documentation](/docs/API.md)
- [Database Schema](/docs/DATABASE.md)
- [Authentication](/docs/AUTH.md)
- [Deployment Guide](/docs/DEPLOYMENT.md)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Busbud API](https://www.busbud.com/api/) for bus schedule data
- [MongoDB](https://www.mongodb.com/) for database
- [Express](https://expressjs.com/) for the web framework
- [Node.js](https://nodejs.org/) for the runtime
- npm (v8 or higher) or yarn (v1.22 or higher)
- Git

### Production
- Node.js (v18 LTS or higher)
- MongoDB Atlas or self-hosted MongoDB (v5.0+)
- Redis (for session management and caching)
- Firebase Project (for Firestore)
- SMTP Server (for email notifications)

### Browser Support
- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Edge (latest 2 versions)

## Getting Started

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/uniglade.git
   cd uniglade
   ```

2. **Install dependencies**
   ```bash
   # Using npm
   npm install
   
   # Or using yarn
   yarn install
   ```

3. **Environment Setup**
   ```bash
   # Copy example environment file
   cp .env.example .env
   ```
   
   Edit the `.env` file with your configuration. See [Environment Variables](#environment-variables) for details.

4. **Database Setup**
   - Install MongoDB if not already installed
   - Create a new database named `uniglade`
   - Or update `MONGODB_URI` in `.env` to point to your MongoDB instance

5. **Firebase Setup**
   - Create a new Firebase project at [Firebase Console](https://console.firebase.google.com/)
   - Generate a new service account key (JSON)
   - Copy the service account details to `.env`

6. **Start the development server**
   ```bash
   # Development mode with hot-reload
   npm run dev
   
   # Or in production mode
   npm start
   ```

7. **Running Tests**
   ```bash
   # Run all tests
   npm test
   
   # Run tests with coverage
   npm run test:coverage
   
   # Run specific test file
   npx jest path/to/test/file.test.js
   ```

### Production Deployment

#### Using Docker (Recommended)

1. **Build the Docker image**
   ```bash
   docker build -t uniglade .
   ```

2. **Run the container**
   ```bash
   docker run -d \
     --name uniglade \
     -p 3000:3000 \
     --env-file .env \
     uniglade
   ```

#### Manual Deployment

1. **Build for production**
   ```bash
   npm run build
   ```

2. **Start the production server**
   ```bash
   NODE_ENV=production node dist/server.js
   ```

#### PM2 (Process Manager)

```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start dist/server.js --name "uniglade"

# Save the process list
pm2 save

# Set up startup script
pm2 startup

# Monitor logs
pm2 logs uniglade
```

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/uniglade

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=90d
JWT_COOKIE_EXPIRES=90

# Client Configuration
CLIENT_URL=http://localhost:3000
CART_EXPIRY_DAYS=7  # Cart expiration in days

# Firebase Configuration (for Firestore)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="your-private-key"

# Email Configuration
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=your-email@example.com
SMTP_PASSWORD=your-email-password
EMAIL_FROM=no-reply@uniglade.com

# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log
LOG_ERROR_FILE=logs/error.log

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100  # Max requests per window
```

## Cart Management

The system implements a robust cart management system with the following features:

### Cart Operations
- **Create Cart**: Automatically created when a user starts a search
- **Add to Cart**: Add trips with selected seats to the cart
- **Update Cart**: Modify passenger details, seat selection, or trip details
- **Remove from Cart**: Remove items from the cart
- **Clear Cart**: Remove all items from the cart
- **Get Cart**: Retrieve current cart contents
- **Checkout**: Convert cart to a booking

### Cart Expiration
- Carts automatically expire after a configurable period (default: 7 days)
- Expired carts are automatically cleaned up
- Users receive notifications before cart expiration

### Purchaser Details
- Secure storage of purchaser information
- Support for multiple passengers per booking
- Data validation and sanitization
- Marketing preferences management
- Transaction-safe updates to ensure data consistency

## Project Structure

```
src/
├── config/           # Configuration files and environment setup
│   ├── firebase.js   # Firebase/Firestore configuration
│   └── index.js      # Application configuration
│
├── controllers/      # Route controllers
│   ├── auth.controller.js    # Authentication endpoints
│   ├── booking.controller.js # Booking management
│   ├── cart.controller.js    # Shopping cart operations
│   └── user.controller.js    # User management
│
├── middlewares/      # Custom express middlewares
│   ├── auth.middleware.js    # Authentication & authorization
│   ├── cart.middleware.js    # Cart validation
│   └── errorHandler.js       # Global error handling
│
├── models/           # Data models
│   ├── booking.model.js     # Booking schema
│   ├── cart.model.js        # Cart schema
│   └── user.model.js        # User schema
│
├── services/         # Business logic
│   ├── busbud.service.js    # Busbud API integration
│   ├── firestore.service.js # Firestore operations
│   └── email.service.js     # Email notifications
│
├── utils/            # Utility classes and functions
│   ├── logger.js     # Logging utility
│   └── validators.js # Data validation
│
├── app.js            # Express app setup
└── server.js         # Server entry point
```

## Cart and Purchaser Data Model

### Cart Document
```javascript
{
  _id: ObjectId,
  userId: String,           // Reference to user (if logged in)
  sessionId: String,        // For guest users
  status: String,           // 'active', 'completed', 'expired'
  items: [{
    tripId: String,         // Reference to trip
    departure: Date,
    arrival: Date,
    origin: String,
    destination: String,
    passengers: [{
      firstName: String,
      lastName: String,
      email: String,
      phone: String,
      seat: String
    }],
    price: Number,
    currency: String
  }],
  createdAt: Date,
  updatedAt: Date,
  expiresAt: Date,          // When the cart will expire
  hasPurchaser: Boolean,    // Whether purchaser details are saved
  metadata: Object          // Additional metadata
}
```

### Purchaser Document (Subcollection)
```javascript
{
  _id: ObjectId,
  cartId: String,           // Reference to parent cart
  firstName: String,
  lastName: String,
  email: String,
  phone: String,
  address: {
    line1: String,
    line2: String,
    city: String,
    state: String,
    postalCode: String,
    country: String
  },
  marketingOptIn: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

## 📚 API Documentation

### Authentication

#### Login
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "yourpassword"
}
```

#### Register
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "user@example.com",
  "password": "securePassword123",
  "confirmPassword": "securePassword123"
}
```

### Carts

#### Create/Get Cart
```http
GET /api/v1/cart
Authorization: Bearer <token>
```

#### Add Item to Cart
```http
POST /api/v1/cart/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "tripId": "trip_123",
  "passengers": [
    {
      "firstName": "John",
      "lastName": "Doe",
      "email": "passenger@example.com",
      "seat": "A12"
    }
  ]
}
```

### Bookings

#### Create Booking
```http
POST /api/v1/bookings
Authorization: Bearer <token>
Content-Type: application/json

{
  "cartId": "cart_123",
  "paymentMethod": "credit_card",
  "billingAddress": {
    "line1": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postalCode": "10001",
    "country": "US"
  }
}
```

### Interactive API Documentation

For interactive API documentation with Swagger UI, visit `/api-docs` when the server is running. This provides:

- Detailed endpoint documentation
- Request/response schemas
- Try-it-out functionality
- Authentication options

## 🏗️ System Architecture

### Tech Stack

#### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (Primary), Firebase Firestore (Secondary)
- **Authentication**: JWT, Firebase Auth
- **Caching**: Redis
- **Search**: MongoDB Text Search
- **Real-time**: Socket.IO

#### Frontend (if applicable)
- **Framework**: React.js
- **State Management**: Redux Toolkit
- **Styling**: Tailwind CSS
- **Build Tool**: Vite

### Data Flow

1. **Request Handling**
   - Request received by Express.js
   - Authentication/Authorization middleware
   - Request validation
   - Route handling
   - Service layer (business logic)
   - Data access layer
   - Response formatting

2. **Real-time Updates**
   - WebSocket connections for real-time features
   - Event-driven architecture for notifications
   - Background jobs for async processing

## 🔒 Security

### Authentication
- JWT-based authentication
- Refresh token rotation
- Rate limiting
- CSRF protection
- CORS configuration

### Data Protection
- Input validation and sanitization
- Data encryption at rest and in transit
- Secure password hashing (bcrypt)
- Regular security audits

### API Security
- Request validation
- Rate limiting
- Request logging
- Error handling without stack traces in production

## 📊 Monitoring & Logging

### Logging
- Structured JSON logging
- Log levels (error, warn, info, debug, trace)
- Request/response logging
- Error tracking

### Monitoring
- Health check endpoints
- Performance metrics
- Error tracking (Sentry/New Relic)
- Uptime monitoring

## 🔄 CI/CD

### GitHub Actions
- Automated testing on PRs
- Code quality checks
- Dependency updates
- Automated deployments

### Deployment
- Staging environment
- Production environment
- Blue-green deployment support
- Rollback procedures

## 🤝 Contributing

### Development Workflow

1. **Fork** the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a **Pull Request**

### Code Style
- Follow [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
- Use ESLint and Prettier for code formatting
- Write unit tests for new features
- Update documentation when necessary

### Commit Message Convention
We follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code changes that neither fixes a bug nor adds a feature
- `perf`: Performance improvements
- `test`: Adding tests
- `chore`: Changes to the build process or auxiliary tools

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

For support, please:
1. Check the [troubleshooting guide](#troubleshooting)
2. Search the [GitHub Issues](https://github.com/yourusername/uniglade/issues)
3. Email support@uniglade.com
4. Open a new issue on GitHub

## 🙏 Acknowledgments

- [Express.js](https://expressjs.com/)
- [MongoDB](https://www.mongodb.com/)
- [Firebase](https://firebase.google.com/)
- [Jest](https://jestjs.io/)
- And all other open-source projects that made this possible

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support, email support@uniglade.com or open an issue in the GitHub repository.

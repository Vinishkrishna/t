# Translation Management Tool (TMT)

A Flask-based web application for managing translation keys and values across multiple languages with MongoDB storage.

## Features

- ✨ Add new translation keys with automatic translation generation
- 🔍 Search and filter translation keys
- ✏️ Edit existing translations
- 🔄 Regenerate translations automatically
- 🗣️ Add new languages dynamically
- 💾 MongoDB persistent storage
- 🎨 Modern, responsive UI

## Prerequisites

- Python 3.8 or higher
- MongoDB (local or Atlas)
- pip (Python package manager)

## Installation

### 1. Clone or Download the Project
```bash
# Create project directory
mkdir translation-management-tool
cd translation-management-tool
```

### 2. Install MongoDB

**Option A: Local MongoDB**
- Download and install from [MongoDB Official Site](https://www.mongodb.com/try/download/community)
- Start MongoDB service:
```bash
  # Windows
  net start MongoDB
  
  # macOS
  brew services start mongodb-community
  
  # Linux
  sudo systemctl start mongod
```

**Option B: MongoDB Atlas (Cloud)**
- Create free account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
- Create a cluster and get connection string
- Update `.env` file with your connection string

### 3. Set Up Python Environment
```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 4. Configure Environment Variables
```bash
# Copy the example env file
cp .env.example .env

# Edit .env file with your MongoDB URI
# For local MongoDB:
MONGO_URI=mongodb://localhost:27017/

# For MongoDB Atlas:
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/
```

### 5. Run the Application
```bash
python app.py
```

The application will be available at `http://localhost:5000`

## Project Structure
```
translation-management-tool/
├── app.py                  # Flask backend application
├── requirements.txt        # Python dependencies
├── .env.example           # Environment variables template
├── .env                   # Your environment variables (create this)
├── static/
│   ├── css/
│   │   └── style.css      # Application styles
│   └── js/
│       └── script.js      # Frontend JavaScript
└── templates/
    └── index.html         # Main HTML template
```

## Usage Guide

### Adding a Translation

1. Go to "Add Translation" tab
2. Enter a translation key (e.g., `HOME_TITLE`)
3. Enter the English value (e.g., `Welcome to Dashboard`)
4. Click "Generate Translations"
5. Review auto-generated translations
6. Translations are automatically saved to MongoDB

### Managing Translations

1. Go to "Manage Translations" tab
2. Use search box to filter translations
3. Click edit icon (✏️) to modify translations
4. Click regenerate icon (🔄) to auto-translate again
5. Click delete icon (🗑️) to remove a translation

### Adding a New Language

1. Go to "Languages" tab
2. Click "Add New Language"
3. Enter language code (e.g., `pl` for Polish)
4. Enter language name (e.g., `Polish`)
5. Click "Add Language"
6. All existing keys will be copied with placeholders

## MongoDB Collections

### translations
```json
{
  "_id": ObjectId,
  "key": "HOME_TITLE",
  "values": {
    "en": "Welcome to Dashboard",
    "es": "Bienvenido al Panel",
    "fr": "Bienvenue au Tableau de Bord"
  },
  "created_at": ISODate,
  "updated_at": ISODate
}
```

### languages
```json
{
  "_id": ObjectId,
  "code": "en",
  "name": "English",
  "is_default": true
}
```

## API Endpoints

- `GET /api/languages` - Get all languages
- `POST /api/languages` - Add new language
- `GET /api/translations` - Get all translations (with optional search)
- `POST /api/translations` - Add new translation
- `PUT /api/translations/<id>` - Update translation
- `DELETE /api/translations/<id>` - Delete translation
- `POST /api/translations/<id>/regenerate` - Regenerate translations

## Troubleshooting

### MongoDB Connection Issues
- Ensure MongoDB service is running
- Check connection string in `.env` file
- For Atlas: Whitelist your IP address

### Port Already in Use
```bash
# Change port in app.py
app.run(debug=True, host='0.0.0.0', port=5001)
```

### Missing Dependencies
```bash
pip install -r requirements.txt --force-reinstall
```

## Technologies Used

- **Backend**: Flask (Python)
- **Database**: MongoDB
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Styling**: Custom CSS (no external frameworks)

## License

This project is for educational and demonstration purposes.
import {BrowserRouter as Router, Route, Routes, Navigate} from 'react-router-dom';
import {StytchUIClient} from '@stytch/vanilla-js';
import {StytchProvider} from '@stytch/react';

import TodoEditor from "./Todos.tsx";
import {Authenticate, Authorize, Login} from "./Auth.tsx";

const stytch = new StytchUIClient(import.meta.env.VITE_STYTCH_PUBLIC_TOKEN);

function App() {
    return (<>
            <main>
                <h1>TODO App MCP Demo</h1>
                <StytchProvider stytch={stytch}>
                    <Router>
                        <Routes>
                            <Route path="/oauth/authorize" element={<Authorize/>}/>
                            <Route path="/login" element={<Login/>}/>
                            <Route path="/authenticate" element={<Authenticate/>}/>
                            <Route path="/todoapp" element={<TodoEditor/>}/>
                            <Route path="*" element={<Navigate to="/todoapp"/>}/>
                        </Routes>
                    </Router>
                </StytchProvider>
            </main>
            <footer>
                Plug in{' '}
                <b><code>{window.location.origin}/sse</code></b>{' '}
                to your MCP instance to access this demo.
            </footer>
        </>

    )
}

export default App


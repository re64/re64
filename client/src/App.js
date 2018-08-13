import React, { Component } from 'react';
import { BrowserRouter, Route, Link } from 'react-router-dom';

import logo from './logo.svg';
import { Layout } from 'antd';
import Button from 'antd/lib/button';
import Projects from './components/projects/projects';
import Project from './components/project/project';
import './App.css';

const { Header, Footer, Sider, Content } = Layout;

const Home = () => (      <div className="App">
        <Layout>
          <Header>Header</Header>
          <Content>
            <div style={{ background: '#fff', padding: 24, minHeight: 280 }}>
              <Projects />
            </div>
          </Content>
          <Footer className="App-footer">
            re64 by Marcus Brinkmann <Link to='/about'>Go to about</Link>
          </Footer>
        </Layout>
      </div>
);

const About = () => (      <div className="App">
        <Layout>
          <Header>Header 2</Header>
          <Content>
            <div style={{ background: '#fff', padding: 24, minHeight: 280 }}>
              <Projects />
            </div>
          </Content>
          <Footer className="App-footer">
            re64 by Marcus Brinkmann
          </Footer>
        </Layout>
      </div>
);

const aProject = ({ match }) => (      <div className="App">
        <Layout>
          <Header>Header 2</Header>
          <Content>
            <Project id={match.params.id} />
          </Content>
          <Footer className="App-footer">
            re64 by Marcus Brinkmann
          </Footer>
        </Layout>
      </div>
);

class App extends Component {
  render() {
    return (
      <BrowserRouter>
        <div>
          <Route exact path="/" component={Home} />
          <Route path="/about" component={About} />
          <Route path="/_/:id" component={aProject} />
        </div>
      </BrowserRouter>
    );
  }
}

export default App;
